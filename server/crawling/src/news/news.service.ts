import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MongoNews,
  NewsDocument as NewsDocumentType,
} from './schemas/news.schema';
import { S3Service } from '../aws/s3.service';

// 뉴스 기사 인터페이스 정의
export interface NewsArticleInfo {
  title: string;
  url: string;
  source: string;
  content?: string;
  author?: string | null;
  tags?: string[];
  publishedAt: Date;
  metadata?: Record<string, any>;
  geopoliticalData?: GeopoliticalData;
  contentKey?: string;
}

// 지정학적 데이터 인터페이스
export interface GeopoliticalData {
  countries: string[];
  regions: string[];
  organizations: string[];
  events: string[];
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    @InjectModel(MongoNews.name)
    private newsModel: Model<NewsDocumentType>,
    private readonly s3Service: S3Service,
  ) {}

  async createNews(newsData: NewsArticleInfo): Promise<void> {
    this.logger.log(`Creating news: ${newsData.title}`);

    try {
      let contentKey = newsData.contentKey;
      let content = '';

      // S3에 콘텐츠 저장 (content가 있는 경우)
      if (newsData.content) {
        contentKey = await this.s3Service.uploadContent(
          newsData.content,
          newsData.source,
        );
        // 간략한 콘텐츠 메타데이터만 저장 (필요시)
        content =
          newsData.content.length > 200
            ? newsData.content.substring(0, 200) + '...'
            : '';
      }

      // Store data in MongoDB
      const newsDoc = new this.newsModel({
        title: newsData.title,
        // content 필드에는 짧은 미리보기 또는 빈 문자열 저장
        content,
        // S3 콘텐츠 키 저장
        contentKey,
        source: newsData.source,
        url: newsData.url,
        author: newsData.author || null,
        tags: newsData.tags || [],
        metadata: newsData.metadata || {},
        publishedAt: newsData.publishedAt,
        // Additional metadata for geopolitical analysis
        entities: [],
        geopoliticalData: newsData.geopoliticalData || {
          countries: [],
          regions: [],
          organizations: [],
          events: [],
        },
      });

      await newsDoc.save();

      this.logger.log(`Successfully saved news: ${newsData.title}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save news: ${errorMessage}`);
      throw error;
    }
  }

  // 기사 전체 내용 조회 (S3에서 가져옴)
  async getFullContent(id: string): Promise<string> {
    const news = await this.newsModel.findById(id).exec();

    if (!news) {
      throw new Error('News article not found');
    }

    if (news.contentKey) {
      try {
        // S3에서 전체 콘텐츠 가져오기
        return await this.s3Service.getContent(news.contentKey);
      } catch (error) {
        this.logger.error(`Error fetching content from S3: ${error.message}`);
        throw error;
      }
    } else if (news.content) {
      // DB에 저장된 콘텐츠 반환
      return news.content;
    } else {
      return 'No content available';
    }
  }

  // 임시 액세스 URL 생성
  async getContentUrl(id: string): Promise<string> {
    const news = await this.newsModel.findById(id).exec();

    if (!news || !news.contentKey) {
      throw new Error('News article not found or has no content key');
    }

    return await this.s3Service.getSignedUrl(news.contentKey);
  }

  // 이미 존재하는 URL 목록 찾기
  async findExistingUrls(urls: string[]): Promise<string[]> {
    const existingNews = await this.newsModel
      .find({
        url: { $in: urls },
      })
      .select('url')
      .exec();

    return existingNews.map((news) => news.url);
  }

  async findAll(): Promise<NewsDocumentType[]> {
    return this.newsModel.find().sort({ publishedAt: -1 }).exec();
  }

  async findOne(id: string): Promise<NewsDocumentType | null> {
    return this.newsModel.findById(id).exec();
  }

  async findBySource(source: string): Promise<NewsDocumentType[]> {
    return this.newsModel.find({ source }).sort({ publishedAt: -1 }).exec();
  }

  async search(query: string): Promise<NewsDocumentType[]> {
    // 텍스트 검색 인덱스를 사용하여 검색 (content는 제외됨)
    if (query.trim().length > 0) {
      return this.newsModel
        .find({ $text: { $search: query } })
        .sort({ score: { $meta: 'textScore' } })
        .exec();
    } else {
      // 검색어가 비어있을 경우 최신순으로 전체 결과 반환
      return this.findAll();
    }
  }

  async getGeopoliticalEvents(): Promise<NewsDocumentType[]> {
    // Get events from MongoDB with enhanced geopolitical data
    return this.newsModel
      .find({ 'geopoliticalData.events': { $exists: true, $ne: [] } })
      .sort({ publishedAt: -1 })
      .exec();
  }

  // 국가별 뉴스 검색
  async findByCountry(country: string): Promise<NewsDocumentType[]> {
    return this.newsModel
      .find({ 'geopoliticalData.countries': country })
      .sort({ publishedAt: -1 })
      .exec();
  }

  // 통계 정보 조회
  async getStatistics(): Promise<any> {
    const totalCount = await this.newsModel.countDocuments();
    const sourceStats = await this.newsModel
      .aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();

    const countryStats = await this.newsModel
      .aggregate([
        { $unwind: '$geopoliticalData.countries' },
        { $group: { _id: '$geopoliticalData.countries', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .exec();

    return {
      totalArticles: totalCount,
      bySource: sourceStats,
      topCountries: countryStats,
    };
  }
}
