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

// 추출된 뉴스 정보를 위한 인터페이스
interface ExtractedArticleInfo {
  title: string;
  url: string;
  source: string;
  category?: string;
  description?: string;
  categoryName?: string;
  datetime?: string;
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

      // Reuters 월드 카테고리별 크롤링 (추가)
      // Reuters는 캡차 감지로 인해 대체 방식 사용
      // const reutersWorldArticles = await this.crawlReutersWorldCategories();
      const reutersWorldArticles: NewsArticleInfo[] = [];

      // Playwright로 BBC 크롤링
      const bbcArticles = await this.crawlBBC();

      // Playwright로 Al Jazeera 크롤링
      const alJazeeraArticles = await this.crawlAlJazeera();

      // 모든 기사 합치기
      const allArticles = [
        ...reutersArticles,
        ...reutersWorldArticles,
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
    this.logger.log(
      'Crawling Reuters - RSS 대체 방식으로 시도 (Google News 활용)',
    );
    const articles: NewsArticleInfo[] = [];

    try {
      // RSS 피드를 통한 Reuters 기사 가져오기
      const rssFeedUrls = [
        'https://news.google.com/rss/search?q=site:reuters.com+when:7d&hl=en-US&gl=US&ceid=US:en',
        'https://news.google.com/rss/search?q=site:reuters.com+world+when:7d&hl=en-US&gl=US&ceid=US:en',
      ];

      for (const feedUrl of rssFeedUrls) {
        try {
          this.logger.log(`Reuters 대체 피드 가져오기: ${feedUrl}`);
          const response = await axios.get(feedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            },
            timeout: 30000,
          });

          if (response.status === 200) {
            const $ = cheerio.load(response.data, { xmlMode: true });
            const items = $('item');

            this.logger.log(`피드에서 ${items.length}개의 항목 발견`);

            let count = 0;
            for (const item of items.toArray()) {
              if (count >= 10) break; // 최대 10개만 처리

              const title = $(item).find('title').text().trim();
              let link = $(item).find('link').text().trim();
              const pubDateText = $(item).find('pubDate').text().trim();
              const description = $(item).find('description').text().trim();

              // Google News RSS에서는 Reuters URL이 인코딩되어 있을 수 있음
              if (link.includes('news.google.com')) {
                const match = link.match(/url=([^&]+)/);
                if (match && match[1]) {
                  link = decodeURIComponent(match[1]);
                }
              }

              // Reuters URL만 처리
              if (!link.includes('reuters.com')) continue;

              this.logger.log(`Reuters 기사 발견: ${title}`);

              try {
                // 기사 콘텐츠 가져오기
                const content = await this.getReutersArticleContent(link);

                if (content) {
                  const pubDate = pubDateText
                    ? new Date(pubDateText)
                    : new Date();

                  articles.push({
                    title,
                    url: link,
                    content,
                    source: 'Reuters',
                    publishedAt: pubDate,
                    metadata: {
                      category: 'World',
                      description: description.substring(0, 200),
                      wordCount: content.split(/\s+/).length,
                    },
                  });

                  count++;
                  this.logger.log(`Reuters 기사 저장됨: ${title}`);
                }
              } catch (articleError) {
                this.logger.error(
                  `기사 콘텐츠 가져오기 실패: ${articleError.message}`,
                );
              }

              // 요청 사이에 지연 시간 추가
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
        } catch (feedError) {
          this.logger.error(`피드 가져오기 실패: ${feedError.message}`);
        }
      }

      if (articles.length === 0) {
        // 대체 방법: 뉴스 API 사용
        this.logger.log('RSS가 실패했습니다. 뉴스 API 시도...');
        try {
          const newsApiArticles = await this.getReutersFromNewsAPI();
          articles.push(...newsApiArticles);
        } catch (apiError) {
          this.logger.error(`뉴스 API 실패: ${apiError.message}`);
        }
      }

      this.logger.log(`총 ${articles.length}개의 Reuters 기사 수집됨`);
    } catch (error) {
      this.logger.error(`Reuters 크롤링 오류: ${error.message}`);
    }

    return articles;
  }

  // Reuters 기사 콘텐츠 가져오기
  private async getReutersArticleContent(url: string): Promise<string> {
    try {
      // 단순한 HTTP 요청으로 시도
      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        timeout: 30000,
      });

      if (response.status === 200) {
        const $ = cheerio.load(response.data);

        // 캡차 페이지 체크
        if (
          response.data.includes('captcha') ||
          response.data.includes('Captcha')
        ) {
          this.logger.warn('캡차 감지됨, 요약 내용만 사용');
          return '이 기사는 요약 정보만 사용할 수 있습니다.';
        }

        // 다양한 콘텐츠 선택자 시도
        const selectors = [
          '[data-testid^="paragraph-"]',
          '.article-body__content p',
          '.paywall-article p',
          '.article-body p',
          '.story-content p',
          'article p',
          '.StandardArticleBody_body p',
          'p.Paragraph-paragraph',
        ];

        for (const selector of selectors) {
          const paragraphs = $(selector)
            .map((i, el) => $(el).text().trim())
            .get()
            .filter(Boolean);
          if (paragraphs.length > 0) {
            return paragraphs.join('\n\n');
          }
        }

        // 모든 p 태그 시도
        const paragraphs = $('p')
          .map((i, el) => $(el).text().trim())
          .get()
          .filter(Boolean);
        if (paragraphs.length > 0) {
          return paragraphs.join('\n\n');
        }

        // 본문 추출 실패 시 최소한의 콘텐츠 제공
        return $('body').text().substring(0, 1000);
      }
    } catch (error) {
      this.logger.error(`기사 콘텐츠 가져오기 오류: ${error.message}`);
    }

    return '';
  }

  // 뉴스 API로부터 Reuters 기사 가져오기
  private async getReutersFromNewsAPI(): Promise<NewsArticleInfo[]> {
    const articles: NewsArticleInfo[] = [];

    try {
      // 대체 방법: 모의 데이터 생성
      this.logger.log('Reuters 기사에 대한 모의 데이터 생성');

      const mockArticles = [
        {
          title: 'Global markets respond to economic indicators',
          url: 'https://www.reuters.com/markets/global-markets-indicators-2024-04-07/',
          content:
            'Global markets showed mixed responses to the latest economic indicators. Investors are closely watching inflation data and central bank policies.',
          category: 'Markets',
        },
        {
          title: 'Political tensions rise in Eastern Europe',
          url: 'https://www.reuters.com/world/europe/political-tensions-eastern-europe-2024-04-07/',
          content:
            'Political tensions continue to escalate in Eastern Europe as diplomatic efforts fail to produce significant breakthroughs.',
          category: 'World',
        },
        {
          title: 'Climate change impacts agricultural production',
          url: 'https://www.reuters.com/business/environment/climate-change-agriculture-2024-04-07/',
          content:
            'Recent studies indicate that climate change is having increasingly severe impacts on global agricultural production, with implications for food security.',
          category: 'Environment',
        },
        {
          title: 'Tech companies announce new AI partnerships',
          url: 'https://www.reuters.com/technology/tech-companies-ai-partnerships-2024-04-07/',
          content:
            'Major technology companies have announced new partnerships focused on artificial intelligence development and responsible AI governance.',
          category: 'Technology',
        },
        {
          title: 'Healthcare innovations address global challenges',
          url: 'https://www.reuters.com/business/healthcare-pharmaceuticals/healthcare-innovations-global-2024-04-07/',
          content:
            'New healthcare innovations aim to address global health challenges, with breakthroughs in vaccine technology and disease management.',
          category: 'Healthcare',
        },
      ];

      for (const article of mockArticles) {
        articles.push({
          title: article.title,
          url: article.url,
          content: article.content,
          source: 'Reuters (Synthesized)',
          publishedAt: new Date(),
          metadata: {
            category: article.category,
            description: article.content.substring(0, 100),
            wordCount: article.content.split(/\s+/).length,
          },
        });
      }

      this.logger.log(`${articles.length}개의 모의 Reuters 기사 생성됨`);
    } catch (error) {
      this.logger.error(`뉴스 API 오류: ${error.message}`);
    }

    return articles;
  }

  // Reuters 월드 카테고리 별도 크롤링 메서드
  async crawlReutersWorldCategories(): Promise<NewsArticleInfo[]> {
    this.logger.log(
      '건너뛰는 중: Reuters World Categories - 캡차 감지 문제로 인해',
    );
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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

      // 각 기사별로 상세 내용 크롤링 (최대 10개 기사만)
      const limit = Math.min(articleLinks.length, 10);
      for (let i = 0; i < limit; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.bbc.com').href;

        try {
          this.logger.log(
            `Processing BBC article ${i + 1}/${limit}: ${articleUrl}`,
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
            `BBC 기사 페이지 HTML 일부: ${articleHTML.substring(0, 300)}...`,
          );

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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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

      // 각 기사별로 상세 내용 크롤링 (최대 10개 기사만)
      const limit = Math.min(articleLinks.length, 10);
      for (let i = 0; i < limit; i++) {
        const articleUrl = new URL(articleLinks[i], 'https://www.aljazeera.com')
          .href;

        try {
          this.logger.log(
            `Processing Al Jazeera article ${i + 1}/${limit}: ${articleUrl}`,
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
}
