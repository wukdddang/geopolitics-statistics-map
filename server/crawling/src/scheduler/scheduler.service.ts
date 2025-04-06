import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CrawlerService } from '../crawler/crawler.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly crawlerService: CrawlerService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async handleCrawlJob() {
    this.logger.log('Starting scheduled crawling job');
    try {
      await this.crawlerService.crawlAllSources();
      this.logger.log('Scheduled crawling job completed successfully');
    } catch (error) {
      this.logger.error(`Scheduled crawling job failed: ${error.message}`);
    }
  }

  // 수동으로 크롤링 작업을 시작할 수 있는 메서드
  async startCrawling() {
    this.logger.log('Starting manual crawling job');
    try {
      await this.crawlerService.crawlAllSources();
      this.logger.log('Manual crawling job completed successfully');
      return { success: true, message: 'Crawling completed successfully' };
    } catch (error) {
      this.logger.error(`Manual crawling job failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
}
