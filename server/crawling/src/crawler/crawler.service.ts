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

  private browser: Browser | null = null;

  constructor(private readonly newsService: NewsService) {}

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
      const bbcArticles = await this.crawlBBC();

      // Playwright로 Al Jazeera 크롤링
      const alJazeeraArticles = await this.crawlAlJazeera();

      // Playwright로 Foreign Policy 크롤링
      const foreignPolicyArticles = await this.crawlForeignPolicy();

      // Playwright로 The Diplomat 크롤링
      const diplomatArticles = await this.crawlTheDiplomat();

      // 새로 추가된 소스들
      // Playwright로 AP News 크롤링
      const apNewsArticles = await this.crawlAPNews();

      // Playwright로 The Guardian 크롤링
      const guardianArticles = await this.crawlGuardian();

      // Playwright로 Euronews 크롤링
      const euronewsArticles = await this.crawlEuronews();

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

  // Reuters 크롤링 구현 - 비활성화 (사이트에서 크롤링을 방지하기 때문)
  async crawlReuters(): Promise<NewsArticleInfo[]> {
    this.logger.log(
      'Reuters 크롤링은 사이트 정책으로 인해 비활성화되었습니다.',
    );
    return [];
  }

  // Reuters 월드 카테고리 별도 크롤링 메서드
  async crawlReutersWorldCategories(): Promise<NewsArticleInfo[]> {
    return [];
  }

  // BBC 크롤링 구현
  async crawlBBC(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling BBC with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();
      await page.goto('https://www.bbc.com/news/world', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 페이지 내용 디버깅
      const bodyHTML = await page.content();
      this.logger.log(`BBC 페이지 HTML 일부: ${bodyHTML.substring(0, 500)}...`);

      // 메인 페이지에서 기사 링크 추출 (선택자 다양화)
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('BBC 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.gs-c-promo-heading',
          'a[href^="/news/world"]',
          '.nw-o-link-split__anchor',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            if (link instanceof HTMLAnchorElement) {
              const href = link.getAttribute('href');
              if (
                href &&
                (href.startsWith('/news/') || href.startsWith('/news/world'))
              ) {
                links.push(href);
              }
            } else {
              const linkElement = link.querySelector('a');
              if (linkElement) {
                const href = linkElement.getAttribute('href');
                if (
                  href &&
                  (href.startsWith('/news/') || href.startsWith('/news/world'))
                ) {
                  links.push(href);
                }
              }
            }
          });
        }

        // 일반적인 뉴스 관련 링크를 찾지 못했다면, 모든 링크 확인
        if (links.length === 0) {
          const allLinks = document.querySelectorAll('a');
          console.log(`Checking all ${allLinks.length} links on the page`);

          allLinks.forEach((link) => {
            const href = link.getAttribute('href');
            if (
              href &&
              (href.startsWith('/news/') || href.startsWith('/news/world'))
            ) {
              links.push(href);
            }
          });
        }

        console.log(`Total unique links found: ${new Set(links).size}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(`Found ${articleLinks.length} article links on BBC`);

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.bbc.com').href;

        try {
          this.logger.log(
            `Processing BBC article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출 - 선택자 다양화
          const title = await page.evaluate(() => {
            console.log('BBC 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '[data-component="headline"]',
              '.story-body__h1',
              '.article-headline__text',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('BBC 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '[data-component="text-block"] p',
              '.story-body__inner p',
              '.article__body p',
              '.story-body p',
              'article p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'BBC World',
              publishedAt: new Date(),
            });
            this.logger.log(`Successfully extracted BBC article: ${title}`);
          } else {
            this.logger.warn(
              `Failed to extract content from BBC article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing BBC article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();
      await page.goto('https://www.aljazeera.com/news/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 페이지 내용 디버깅
      const bodyHTML = await page.content();
      this.logger.log(
        `Al Jazeera 페이지 HTML 일부: ${bodyHTML.substring(0, 500)}...`,
      );

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('Al Jazeera 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          'article a',
          '.article-card a',
          'a[href^="/news/"]',
          '.u-clickable-card__link',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('/news/') && !links.includes(href)) {
              links.push(href);
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 모든 링크 확인
        if (links.length < 5) {
          const allLinks = document.querySelectorAll('a');
          console.log(`Checking all ${allLinks.length} links on the page`);

          allLinks.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('/news/') && !links.includes(href)) {
              links.push(href);
            }
          });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(
        `Found ${articleLinks.length} article links on Al Jazeera`,
      );

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.aljazeera.com')
          .href;

        try {
          this.logger.log(
            `Processing Al Jazeera article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 기사 페이지 HTML 디버깅
          const articleHTML = await page.content();
          this.logger.log(
            `Al Jazeera 기사 페이지 HTML 일부: ${articleHTML.substring(0, 300)}...`,
          );

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('Al Jazeera 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '.article-header h1',
              '.article__title',
              '.post-title',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('Al Jazeera 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.wysiwyg p',
              '.wysiwyg--all-content p',
              '.article__content p',
              '.article-body p',
              '.article-p-wrapper p',
              'article p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'Al Jazeera',
              publishedAt: new Date(),
            });
            this.logger.log(
              `Successfully extracted Al Jazeera article: ${title}`,
            );
          } else {
            this.logger.warn(
              `Failed to extract content from Al Jazeera article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing Al Jazeera article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in Al Jazeera crawler: ${error.message}`);
    }

    return articles;
  }

  // Foreign Policy 크롤링 구현
  async crawlForeignPolicy(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Foreign Policy with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto('https://foreignpolicy.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 페이지 내용 디버깅
      const bodyHTML = await page.content();
      this.logger.log(
        `Foreign Policy 페이지 HTML 일부: ${bodyHTML.substring(0, 500)}...`,
      );

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('Foreign Policy 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.article-card a',
          '.article-item a',
          '.article-title a',
          '.headline a',
          '.card-title a',
          '.post-title a',
          'h3 a',
          'h2 a',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && !links.includes(href)) {
              // URL 유효성 확인
              if (href.startsWith('http') || href.startsWith('/')) {
                links.push(href);
              }
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 더 일반적인 항목 확인
        if (links.length < 5) {
          // 모든 article 요소 내 링크 확인
          document.querySelectorAll('article a').forEach((link) => {
            const href = link.getAttribute('href');
            if (
              href &&
              !links.includes(href) &&
              (href.startsWith('http') || href.startsWith('/'))
            ) {
              links.push(href);
            }
          });

          // 마지막 시도: 메인 콘텐츠 영역 내 모든 링크
          document
            .querySelectorAll('main a, .content a, .main-content a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/')) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(
        `Found ${articleLinks.length} article links on Foreign Policy`,
      );

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        let articleUrl = articleLinks[i];

        // 상대 URL 처리
        if (articleUrl.startsWith('/')) {
          articleUrl = new URL(articleUrl, 'https://foreignpolicy.com').href;
        }

        try {
          this.logger.log(
            `Processing Foreign Policy article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('Foreign Policy 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '.article-header h1',
              '.post-title',
              '.headline',
              '.article-title',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('Foreign Policy 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.post-content p',
              '.article-content p',
              '.article-body p',
              '.entry-content p',
              '.content-body p',
              'article p',
              '.paywall p',
              '.article__body p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          // 출판일 추출 시도
          const publishedAt = await page.evaluate(() => {
            const dateSelectors = [
              'time',
              '.date',
              '.post-date',
              '.article-date',
              '[itemprop="datePublished"]',
              '.published-date',
            ];

            for (const selector of dateSelectors) {
              const dateEl = document.querySelector(selector);
              if (dateEl) {
                const dateStr =
                  dateEl.getAttribute('datetime') || dateEl.textContent;
                if (dateStr) return dateStr.trim();
              }
            }

            return null;
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'Foreign Policy',
              publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
            });
            this.logger.log(
              `Successfully extracted Foreign Policy article: ${title}`,
            );
          } else {
            this.logger.warn(
              `Failed to extract content from Foreign Policy article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing Foreign Policy article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in Foreign Policy crawler: ${error.message}`);
    }

    return articles;
  }

  // The Diplomat 크롤링 구현
  async crawlTheDiplomat(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling The Diplomat with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto('https://thediplomat.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 페이지 내용 디버깅
      const bodyHTML = await page.content();
      this.logger.log(
        `The Diplomat 페이지 HTML 일부: ${bodyHTML.substring(0, 500)}...`,
      );

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('The Diplomat 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.entry-title a',
          '.article-title a',
          '.td-module-title a',
          '.item-details a',
          '.td_module_wrap a',
          '.td-image-wrap',
          'h3 a',
          'h2 a',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && !links.includes(href)) {
              // URL 유효성 확인
              if (href.startsWith('http') || href.startsWith('/')) {
                links.push(href);
              }
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 더 일반적인 항목 확인
        if (links.length < 5) {
          // 모든 article 요소 내 링크 확인
          document.querySelectorAll('article a').forEach((link) => {
            const href = link.getAttribute('href');
            if (
              href &&
              !links.includes(href) &&
              (href.startsWith('http') || href.startsWith('/'))
            ) {
              links.push(href);
            }
          });

          // 마지막 시도: 메인 콘텐츠 영역 내 모든 링크
          document
            .querySelectorAll('main a, #content a, .td-main-content a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/')) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(
        `Found ${articleLinks.length} article links on The Diplomat`,
      );

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        let articleUrl = articleLinks[i];

        // 상대 URL 처리
        if (articleUrl.startsWith('/')) {
          articleUrl = new URL(articleUrl, 'https://thediplomat.com').href;
        }

        try {
          this.logger.log(
            `Processing The Diplomat article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('The Diplomat 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              '.entry-title',
              '.tdb-title-text',
              'h1.entry-title',
              'h1',
              '.post-title',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('The Diplomat 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.td-post-content p',
              '.entry-content p',
              '.tdb-block-inner p',
              '.art-content p',
              'article p',
              '.post-content p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          // 출판일 추출 시도
          const publishedAt = await page.evaluate(() => {
            const dateSelectors = [
              'time',
              '.entry-date',
              '.td-post-date',
              '.published',
              '.entry-meta .date',
              '[itemprop="datePublished"]',
            ];

            for (const selector of dateSelectors) {
              const dateEl = document.querySelector(selector);
              if (dateEl) {
                const dateStr =
                  dateEl.getAttribute('datetime') || dateEl.textContent;
                if (dateStr) return dateStr.trim();
              }
            }

            return null;
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'The Diplomat',
              publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
            });
            this.logger.log(
              `Successfully extracted The Diplomat article: ${title}`,
            );
          } else {
            this.logger.warn(
              `Failed to extract content from The Diplomat article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing The Diplomat article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in The Diplomat crawler: ${error.message}`);
    }

    return articles;
  }

  // AP News 크롤링 구현
  async crawlAPNews(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling AP News with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto('https://apnews.com/hub/world-news', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('AP News 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.PageList-items-item a',
          '.CardHeadline a',
          '.headline a',
          '.Article-headline a',
          'a[data-key="card-headline"]',
          '.Component-headline a',
          '.ContentList-items-item a',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && !links.includes(href)) {
              // URL 유효성 확인
              if (href.startsWith('http') || href.startsWith('/')) {
                links.push(href);
              }
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 더 일반적인 선택자 시도
        if (links.length < 5) {
          // Feed 관련 선택자 추가 시도
          document
            .querySelectorAll('.FeedCard a, .Card a, [data-testid="card"] a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/')) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });

          // 마지막 시도: 메인 콘텐츠 영역 내 모든 링크
          document
            .querySelectorAll('main a, .Main a, .content a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/')) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(`Found ${articleLinks.length} article links on AP News`);

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        let articleUrl = articleLinks[i];

        // 상대 URL 처리
        if (articleUrl.startsWith('/')) {
          articleUrl = new URL(articleUrl, 'https://apnews.com').href;
        }

        try {
          this.logger.log(
            `Processing AP News article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('AP News 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '.Article-headline',
              '.CardHeadline',
              '.headline',
              '[data-key="headline"]',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('AP News 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.Article-content p',
              '.article-body p',
              '.RichTextStoryBody p',
              '.RichTextBody p',
              '.story-body p',
              '[data-key="article-body"] p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          // 출판일 추출 시도
          const publishedAt = await page.evaluate(() => {
            const dateSelectors = [
              'time',
              '.Timestamp',
              '.Article-datePublished',
              '[data-key="timestamp"]',
              '.published-date',
              '.Article-timestamp',
            ];

            for (const selector of dateSelectors) {
              const dateEl = document.querySelector(selector);
              if (dateEl) {
                const dateStr =
                  dateEl.getAttribute('datetime') || dateEl.textContent;
                if (dateStr) return dateStr.trim();
              }
            }

            return null;
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'AP News',
              publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
            });
            this.logger.log(`Successfully extracted AP News article: ${title}`);
          } else {
            this.logger.warn(
              `Failed to extract content from AP News article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing AP News article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in AP News crawler: ${error.message}`);
    }

    return articles;
  }

  // The Guardian 크롤링 구현
  async crawlGuardian(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling The Guardian with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto('https://www.theguardian.com/world', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('The Guardian 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.fc-item__link',
          '.js-headline-text',
          '.u-faux-block-link__overlay',
          '.fc-item a',
          '.dcr-12dozo2 a',
          '.dcr-12dotks a',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            if (link instanceof HTMLAnchorElement) {
              const href = link.getAttribute('href');
              if (href && !links.includes(href)) {
                links.push(href);
              }
            } else {
              const linkEl = link.closest('a');
              if (linkEl) {
                const href = linkEl.getAttribute('href');
                if (href && !links.includes(href)) {
                  links.push(href);
                }
              }
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 더 일반적인 선택자 시도
        if (links.length < 5) {
          // 모든 카드와 관련 링크 확인
          document
            .querySelectorAll('[data-link-name="article"] a, .dcr-1989ovb a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (href && !links.includes(href)) {
                links.push(href);
              }
            });

          // 마지막 시도: 메인 콘텐츠 영역 내 모든 링크
          document
            .querySelectorAll('main a, [data-component="main-media"] a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(
        `Found ${articleLinks.length} article links on The Guardian`,
      );

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        let articleUrl = articleLinks[i];

        // URL이 https://로 시작하는지 확인
        if (!articleUrl.startsWith('http')) {
          articleUrl = new URL(articleUrl, 'https://www.theguardian.com').href;
        }

        try {
          this.logger.log(
            `Processing The Guardian article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('The Guardian 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '.dcr-y70mar',
              '.dcr-125vfar',
              '.content__headline',
              '[data-gu-name="headline"]',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('The Guardian 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.dcr-1jfr4vo p',
              '.article-body-commercial-selector p',
              '.content__article-body p',
              '.article-body p',
              '.js-article__body p',
              '.dcr-qq7igw p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          // 출판일 추출 시도
          const publishedAt = await page.evaluate(() => {
            const dateSelectors = [
              'time',
              '.content__dateline time',
              '.dcr-u0h1qy time',
              '[data-component="meta-byline"] time',
              '.dcr-hfp9tp',
            ];

            for (const selector of dateSelectors) {
              const dateEl = document.querySelector(selector);
              if (dateEl) {
                const dateStr =
                  dateEl.getAttribute('datetime') || dateEl.textContent;
                if (dateStr) return dateStr.trim();
              }
            }

            return null;
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'The Guardian',
              publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
            });
            this.logger.log(
              `Successfully extracted The Guardian article: ${title}`,
            );
          } else {
            this.logger.warn(
              `Failed to extract content from The Guardian article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing The Guardian article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in The Guardian crawler: ${error.message}`);
    }

    return articles;
  }

  // Euronews 크롤링 구현
  async crawlEuronews(): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Euronews with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
      const browser = await this.initBrowser();
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto('https://www.euronews.com/news/international', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // 페이지 로딩 대기 추가
      await page.waitForTimeout(5000);

      // 메인 페이지에서 기사 링크 추출
      const articleLinks = await page.evaluate(() => {
        const links: string[] = [];
        console.log('Euronews 페이지 DOM 검색 시작');

        // 여러 선택자 시도
        const selectors = [
          '.c-most-viewed__article a',
          '.m-object__title a',
          '.c-teaser__title a',
          'article a.u-clickable-card__link',
          '.o-block-more-news-themes__articles__wrapper a',
          '.c-article-teaser a',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Found ${elements.length} elements with selector ${selector}`,
          );

          elements.forEach((link) => {
            const href = link.getAttribute('href');
            if (href && !links.includes(href)) {
              // URL 유효성 확인
              if (href.startsWith('http') || href.startsWith('/')) {
                links.push(href);
              }
            }
          });
        }

        // 충분한 링크를 찾지 못했다면, 더 일반적인 선택자 시도
        if (links.length < 5) {
          // 모든 article 요소 내 링크 확인
          document
            .querySelectorAll('article a, .c-article-teaser a, .c-teaser a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/'))
              ) {
                links.push(href);
              }
            });

          // 마지막 시도: 헤드라인 클래스 및 메인 콘텐츠 영역 내 모든 링크
          document
            .querySelectorAll('.c-teaser-article__title a, main a')
            .forEach((link) => {
              const href = link.getAttribute('href');
              if (
                href &&
                !links.includes(href) &&
                (href.startsWith('http') || href.startsWith('/')) &&
                !href.includes('#') &&
                !href.includes('javascript:') &&
                !href.includes('mailto:')
              ) {
                links.push(href);
              }
            });
        }

        console.log(`Total unique links found: ${links.length}`);
        return [...new Set(links)]; // 중복 제거
      });

      this.logger.log(`Found ${articleLinks.length} article links on Euronews`);

      // 각 기사별로 상세 내용 크롤링 - 모든 기사 처리
      for (let i = 0; i < articleLinks.length; i++) {
        let articleUrl = articleLinks[i];

        // 상대 URL 처리
        if (articleUrl.startsWith('/')) {
          articleUrl = new URL(articleUrl, 'https://www.euronews.com').href;
        }

        try {
          this.logger.log(
            `Processing Euronews article ${i + 1}/${articleLinks.length}: ${articleUrl}`,
          );

          // 기사 페이지로 이동
          await page.goto(articleUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(3000);

          // 제목, 내용 추출
          const title = await page.evaluate(() => {
            console.log('Euronews 기사 제목 추출 시작');

            // 제목 선택자 여러 개 시도
            const titleSelectors = [
              'h1',
              '.c-article-title',
              '.o-article__title',
              '.article__title',
              '.c-article__title',
            ];

            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              if (titleEl && titleEl.textContent) {
                console.log(`Found title with selector ${selector}`);
                return titleEl.textContent.trim();
              }
            }

            return '';
          });

          const content = await page.evaluate(() => {
            console.log('Euronews 기사 내용 추출 시작');

            // 내용 선택자 여러 개 시도
            const contentSelectors = [
              '.c-article-content p',
              '.article__content p',
              '.article-text p',
              '.o-article__body p',
              '.article-body p',
              '.c-article-body p',
            ];

            for (const selector of contentSelectors) {
              const paragraphs = document.querySelectorAll(selector);
              if (paragraphs.length > 0) {
                console.log(
                  `Found ${paragraphs.length} paragraphs with selector ${selector}`,
                );
                return Array.from(paragraphs)
                  .map((p) => (p.textContent ? p.textContent.trim() : ''))
                  .filter(Boolean)
                  .join('\n\n');
              }
            }

            // 모든 p 태그 시도
            const allParagraphs = document.querySelectorAll('p');
            if (allParagraphs.length > 0) {
              console.log(
                `Falling back to all ${allParagraphs.length} paragraphs`,
              );
              return Array.from(allParagraphs)
                .map((p) => (p.textContent ? p.textContent.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
            }

            return '';
          });

          // 출판일 추출 시도
          const publishedAt = await page.evaluate(() => {
            const dateSelectors = [
              'time',
              '.c-article-date',
              '.o-article__publish-date',
              '.article__date',
              '.article-date',
              '.c-article__date',
              '[data-test="article-dates"]',
            ];

            for (const selector of dateSelectors) {
              const dateEl = document.querySelector(selector);
              if (dateEl) {
                const dateStr =
                  dateEl.getAttribute('datetime') || dateEl.textContent;
                if (dateStr) return dateStr.trim();
              }
            }

            return null;
          });

          if (title && content) {
            articles.push({
              title,
              url: articleUrl,
              content,
              source: 'Euronews',
              publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
            });
            this.logger.log(
              `Successfully extracted Euronews article: ${title}`,
            );
          } else {
            this.logger.warn(
              `Failed to extract content from Euronews article: ${articleUrl}`,
            );
            this.logger.warn(
              `Title: ${title ? 'OK' : 'Missing'}, Content: ${content ? 'OK' : 'Missing'}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error processing Euronews article ${articleUrl}: ${error.message}`,
          );
        }

        // 서버 부담 줄이기 위해 요청 간 딜레이
        await new Promise((r) => setTimeout(r, 2000));
      }

      await page.close();
    } catch (error) {
      this.logger.error(`Error in Euronews crawler: ${error.message}`);
    }

    return articles;
  }
}
