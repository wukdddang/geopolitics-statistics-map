import { Injectable, Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import { NewsArticleInfo } from '../../news/interfaces/news.interface';

@Injectable()
export class BBCCrawlerService {
  private readonly logger = new Logger(BBCCrawlerService.name);

  async crawlBBC(browser: Browser): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling BBC with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
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
}
