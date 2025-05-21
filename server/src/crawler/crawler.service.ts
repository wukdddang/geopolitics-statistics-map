import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsService } from '../news/news.service';
import { NewsArticleInfo, NewsSource } from '../news/interfaces/news.interface';
import { Browser, chromium } from 'playwright';
import { Injectable, Logger } from '@nestjs/common';
import { BBCCrawlerService } from './services/bbc-crawler.service';
import { AlJazeeraCrawlerService } from './services/al-jazeera-crawler.service';
import { ForeignPolicyCrawlerService } from './services/foreign-policy-crawler.service';
import { TheDiplomatCrawlerService } from './services/the-diplomat-crawler.service';
import { APNewsCrawlerService } from './services/ap-news-crawler.service';
import { GuardianCrawlerService } from './services/guardian-crawler.service';
import { EuronewsCrawlerService } from './services/euronews-crawler.service';

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  private browser: Browser | null = null;

  constructor(
    private readonly newsService: NewsService,
    private readonly bbcCrawlerService: BBCCrawlerService,
    private readonly alJazeeraCrawlerService: AlJazeeraCrawlerService,
    private readonly foreignPolicyCrawlerService: ForeignPolicyCrawlerService,
    private readonly theDiplomatCrawlerService: TheDiplomatCrawlerService,
    private readonly apNewsCrawlerService: APNewsCrawlerService,
    private readonly guardianCrawlerService: GuardianCrawlerService,
    private readonly euronewsCrawlerService: EuronewsCrawlerService,
  ) {}

  async crawlAllSources(): Promise<void> {
    this.logger.log('Starting to crawl all sources');

    try {
      // Reuters는 크롤링 방지 기능으로 인해 제외
      // const reutersArticles = await this.crawlReuters();
      // const reutersWorldArticles: NewsArticleInfo[] = [];

      // 빈 배열 사용
      const reutersArticles: NewsArticleInfo[] = [];
      const reutersWorldArticles: NewsArticleInfo[] = [];

      // Playwright로 BBC 크롤링
      const browser = await this.initBrowser();
      const bbcArticles = await this.bbcCrawlerService.crawlBBC(browser);

      // Playwright로 Al Jazeera 크롤링
      const alJazeeraArticles =
        await this.alJazeeraCrawlerService.crawlAlJazeera(browser);

      // Playwright로 Foreign Policy 크롤링
      const foreignPolicyArticles =
        await this.foreignPolicyCrawlerService.crawlForeignPolicy(browser);

      // Playwright로 The Diplomat 크롤링
      const diplomatArticles =
        await this.theDiplomatCrawlerService.crawlTheDiplomat(browser);

      // Playwright로 AP News 크롤링
      const apNewsArticles =
        await this.apNewsCrawlerService.crawlAPNews(browser);

      // Playwright로 The Guardian 크롤링
      const guardianArticles =
        await this.guardianCrawlerService.crawlGuardian(browser);

      // Playwright로 Euronews 크롤링
      const euronewsArticles =
        await this.euronewsCrawlerService.crawlEuronews(browser);

      // 모든 기사 합치기
      const allArticles = [
        ...reutersArticles,
        ...reutersWorldArticles,
        ...bbcArticles,
        ...alJazeeraArticles,
        ...foreignPolicyArticles,
        ...diplomatArticles,
        ...apNewsArticles,
        ...guardianArticles,
        ...euronewsArticles,
      ];

      // URL 중복 체크
      const urls = allArticles.map((article) => article.url);
      const existingUrls = await this.newsService.findExistingUrls(urls);

      // 신규 기사만 저장
      let savedCount = 0;
      for (const article of allArticles) {
        if (!existingUrls.includes(article.url)) {
          // 기사 저장 전 지정학적 데이터 추출
          const countries = this.extractCountries(article.content || '');
          article.geopoliticalData = {
            countries,
            regions: [],
            organizations: [],
            events: [],
          };

          await this.newsService.createNews(article);
          savedCount++;
        }
      }

      this.logger.log(
        `총 ${allArticles.length}개 기사 중 ${savedCount}개의 새 기사가 저장되었습니다.`,
      );

      // 기존 소스 크롤링은 건너뜁니다 (이제 모든 소스를 Playwright로 크롤링)
    } catch (error) {
      this.logger.error(`Error in crawlAllSources: ${error.message}`);
    } finally {
      // 브라우저 리소스 정리
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    }

    this.logger.log('Completed crawling all sources');
  }

  async crawlSource(source: NewsSource): Promise<void> {
    this.logger.log(`Crawling ${source.name}`);

    try {
      const response = await axios.get(source.url);
      const $ = cheerio.load(response.data);

      const articles: NewsArticleInfo[] = [];

      $(source.selector).each((i, element) => {
        const titleElement = $(element).find(source.titleSelector);
        const title = titleElement.text().trim();

        if (!title) return;

        const linkElement = titleElement.closest(source.linkSelector);
        let url = linkElement.attr('href');

        if (!url) return;

        // Handle relative URLs
        if (url.startsWith('/')) {
          url = `${source.baseUrl}${url}`;
        }

        articles.push({
          title,
          url,
          source: source.name,
          publishedAt: new Date(), // 기본값 제공
        });
      });

      this.logger.log(`Found ${articles.length} articles from ${source.name}`);

      // URL 목록 배열 생성
      const urls = articles.map((article) => article.url);

      // 이미 존재하는 URL 확인
      const existingUrls = await this.newsService.findExistingUrls(urls);

      // 새로운 기사만 처리
      const newArticles = articles.filter(
        (article) => !existingUrls.includes(article.url),
      );

      this.logger.log(
        `Processing ${newArticles.length} new articles out of ${articles.length} total`,
      );

      // Process each new article to get full content
      for (const article of newArticles) {
        try {
          await this.processArticle(article);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Error processing article ${article.url}: ${errorMessage}`,
          );
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching ${source.url}: ${errorMessage}`);
      throw error;
    }
  }

  async processArticle(articleInfo: NewsArticleInfo): Promise<void> {
    this.logger.log(`Processing article: ${articleInfo.title}`);

    try {
      const response = await axios.get(articleInfo.url);
      const $ = cheerio.load(response.data);

      // Extract content based on common content selectors
      // This is simplified and would need to be adjusted for each site
      const contentSelectors = [
        'article',
        '.article-body',
        '.story-body',
        '.article__content',
        '#article-body',
        '.story-content',
      ];

      let content = '';

      for (const selector of contentSelectors) {
        const selectedContent = $(selector).text().trim();
        if (selectedContent && selectedContent.length > content.length) {
          content = selectedContent;
        }
      }

      if (!content) {
        content = $('body').text().trim();
      }

      // 간단한 지정학적 엔티티 추출 (국가명)
      const countries = this.extractCountries(content);

      // Extract publication date
      const publishedAt = new Date();

      // Create a full article object
      const article: NewsArticleInfo = {
        ...articleInfo,
        content,
        publishedAt,
        metadata: {
          wordCount: content.split(' ').length,
        },
        // 지정학적 데이터 포함
        geopoliticalData: {
          countries,
          regions: [],
          organizations: [],
          events: [],
        },
      };

      // Save the article
      await this.newsService.createNews(article);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error processing article ${articleInfo.url}: ${errorMessage}`,
      );
      throw error;
    }
  }

  // 간단한 국가명 추출 함수
  private extractCountries(text: string): string[] {
    const countries = [
      'United States',
      'China',
      'Russia',
      'India',
      'Japan',
      'South Korea',
      'North Korea',
      'UK',
      'France',
      'Germany',
      'Israel',
      'Iran',
      'Saudi Arabia',
      'Ukraine',
      'Taiwan',
      'Canada',
      'Australia',
      'Brazil',
      'Mexico',
      'Egypt',
      'South Africa',
      'Nigeria',
      'Pakistan',
      'Indonesia',
    ];

    return countries.filter((country) =>
      text.toLowerCase().includes(country.toLowerCase()),
    );
  }

  // 브라우저 초기화 메서드
  private async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true, // true: 화면 표시 없음, false: 브라우저 표시 (디버깅용)
      });
    }
    return this.browser;
  }
}
