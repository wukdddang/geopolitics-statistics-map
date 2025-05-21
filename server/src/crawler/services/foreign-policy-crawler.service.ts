import { Injectable, Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import { NewsArticleInfo } from '../../news/interfaces/news.interface';

@Injectable()
export class ForeignPolicyCrawlerService {
  private readonly logger = new Logger(ForeignPolicyCrawlerService.name);

  async crawlForeignPolicy(browser: Browser): Promise<NewsArticleInfo[]> {
    this.logger.log('Crawling Foreign Policy with Playwright');
    const articles: NewsArticleInfo[] = [];

    try {
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
}
