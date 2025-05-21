import { Injectable, Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import { NewsArticleInfo } from '../../news/interfaces/news.interface';

@Injectable()
export class EuronewsCrawlerService {
  private readonly logger = new Logger(EuronewsCrawlerService.name);

  async crawlEuronews(browser: Browser): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Euronews with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
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
