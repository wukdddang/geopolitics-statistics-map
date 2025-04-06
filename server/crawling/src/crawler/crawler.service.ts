import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsService, NewsArticleInfo } from '../news/news.service';
import { Browser, chromium } from 'playwright';

// 뉴스 소스 인터페이스 정의
interface NewsSource {
  name: string;
  url: string;
  selector: string;
  titleSelector: string;
  linkSelector: string;
  baseUrl: string;
}

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly sources: NewsSource[] = [
    {
      name: 'Reuters World',
      url: 'https://www.reuters.com/world/',
      selector: 'article',
      titleSelector: 'h3',
      linkSelector: 'a',
      baseUrl: 'https://www.reuters.com',
    },
    {
      name: 'BBC World',
      url: 'https://www.bbc.com/news/world',
      selector: '.gs-c-promo',
      titleSelector: '.gs-c-promo-heading__title',
      linkSelector: 'a',
      baseUrl: 'https://www.bbc.com',
    },
    {
      name: 'Al Jazeera',
      url: 'https://www.aljazeera.com/news/',
      selector: 'article',
      titleSelector: 'h3',
      linkSelector: 'a',
      baseUrl: 'https://www.aljazeera.com',
    },
    {
      name: 'Foreign Policy',
      url: 'https://foreignpolicy.com/',
      selector: 'article',
      titleSelector: 'h3',
      linkSelector: 'a',
      baseUrl: '',
    },
    {
      name: 'The Diplomat',
      url: 'https://thediplomat.com/',
      selector: 'article',
      titleSelector: 'h2, h3',
      linkSelector: 'a',
      baseUrl: '',
    },
  ];

  private browser: Browser | null = null;

  constructor(private readonly newsService: NewsService) {}

  async crawlAllSources(): Promise<void> {
    this.logger.log('Starting to crawl all sources');

    try {
      // Playwright로 Reuters 크롤링
      const reutersArticles = await this.crawlReuters();

      // Playwright로 BBC 크롤링
      const bbcArticles = await this.crawlBBC();

      // Playwright로 Al Jazeera 크롤링
      const alJazeeraArticles = await this.crawlAlJazeera();

      // 모든 기사 합치기
      const allArticles = [
        ...reutersArticles,
        ...bbcArticles,
        ...alJazeeraArticles,
      ];

      // URL 중복 체크
      const urls = allArticles.map((article) => article.url);
      const existingUrls = await this.newsService.findExistingUrls(urls);

      // 신규 기사만 저장
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
        }
      }

      // 기존 소스 크롤링 (선택적) - 일단 Foreign Policy와 The Diplomat만 cheerio로 크롤링
      for (const source of this.sources) {
        if (
          source.name !== 'Reuters World' &&
          source.name !== 'BBC World' &&
          source.name !== 'Al Jazeera'
        ) {
          try {
            await this.crawlSource(source);
          } catch (error) {
            this.logger.error(
              `Error crawling ${source.name}: ${error.message}`,
            );
          }
        }
      }
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

  // Reuters 크롤링 구현
  async crawlReuters(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Reuters with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      });

      const page = await context.newPage();
      await page.goto('https://www.reuters.com/world/', {
        waitUntil: 'domcontentloaded',
      });

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        document.querySelectorAll('a[href*="/world/"]').forEach((link) => {
          const href = link.getAttribute('href');
          if (href && href.includes('/article/')) {
            links.push(href);
          }
        });
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(`Found ${articleLinks.length} article links on Reuters`);

      // 각 기사별로 상세 내용 크롤링 (최대 10개 기사만)
      const limit = Math.min(articleLinks.length, 10);
      for (let i = 0; i < limit; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.reuters.com')
          .href;

        try {
          // 기사 페이지로 이동
          await page.goto(articleUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            const titleEl = document.querySelector('h1');
            return titleEl ? titleEl.textContent?.trim() : '';
          });

          const content = await page.evaluate(() => {
            const paragraphs = Array.from(
              document.querySelectorAll('.article-body p'),
            );
            return paragraphs
              .map((p) => p.textContent?.trim())
              .filter(Boolean)
              .join('\n\n');
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'Reuters',
              publishedAt: new Date(),
            });
            this.logger.log(`Extracted article: ${title}`);
          }
        } catch (error) {
          this.logger.error(
            `Error processing article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 1000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in Reuters crawler: ${error.message}`);
    }

    return articles;
  }

  // BBC 크롤링 구현
  async crawlBBC(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling BBC with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      });

      const page = await context.newPage();
      await page.goto('https://www.bbc.com/news/world', {
        waitUntil: 'domcontentloaded',
      });

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        document.querySelectorAll('.gs-c-promo-heading').forEach((link) => {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/news/')) {
            links.push(href);
          }
        });
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(`Found ${articleLinks.length} article links on BBC`);

      // 각 기사별로 상세 내용 크롤링 (최대 10개 기사만)
      const limit = Math.min(articleLinks.length, 10);
      for (let i = 0; i < limit; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.bbc.com').href;

        try {
          // 기사 페이지로 이동
          await page.goto(articleUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            const titleEl = document.querySelector('h1');
            return titleEl ? titleEl.textContent?.trim() : '';
          });

          const content = await page.evaluate(() => {
            // BBC 기사 본문 선택자
            const paragraphs = Array.from(
              document.querySelectorAll('[data-component="text-block"] p'),
            );
            return paragraphs
              .map((p) => p.textContent?.trim())
              .filter(Boolean)
              .join('\n\n');
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'BBC World',
              publishedAt: new Date(),
            });
            this.logger.log(`Extracted article: ${title}`);
          }
        } catch (error) {
          this.logger.error(
            `Error processing article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 1000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in BBC crawler: ${error.message}`);
    }

    return articles;
  }

  // Al Jazeera 크롤링 구현
  async crawlAlJazeera(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Al Jazeera with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      });

      const page = await context.newPage();
      await page.goto('https://www.aljazeera.com/news/', {
        waitUntil: 'domcontentloaded',
      });

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        document.querySelectorAll('article a').forEach((link) => {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/news/') && !links.includes(href)) {
            links.push(href);
          }
        });
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(
        `Found ${articleLinks.length} article links on Al Jazeera`,
      );

      // 각 기사별로 상세 내용 크롤링 (최대 10개 기사만)
      const limit = Math.min(articleLinks.length, 10);
      for (let i = 0; i < limit; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.aljazeera.com')
          .href;

        try {
          // 기사 페이지로 이동
          await page.goto(articleUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            const titleEl = document.querySelector('h1');
            return titleEl ? titleEl.textContent?.trim() : '';
          });

          const content = await page.evaluate(() => {
            // Al Jazeera 기사 본문 선택자
            const paragraphs = Array.from(
              document.querySelectorAll('.wysiwyg--all-content p'),
            );
            return paragraphs
              .map((p) => p.textContent?.trim())
              .filter(Boolean)
              .join('\n\n');
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'Al Jazeera',
              publishedAt: new Date(),
            });
            this.logger.log(`Extracted article: ${title}`);
          }
        } catch (error) {
          this.logger.error(
            `Error processing article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 1000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in Al Jazeera crawler: ${error.message}`);
    }

    return articles;
  }
}
