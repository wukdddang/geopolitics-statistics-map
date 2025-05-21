import { Injectable, Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import { NewsArticleInfo } from '../../news/interfaces/news.interface';

@Injectable()
export class AlJazeeraCrawlerService {
  private readonly logger = new Logger(AlJazeeraCrawlerService.name);

  async crawlAlJazeera(browser: Browser): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Al Jazeera with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
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
}
