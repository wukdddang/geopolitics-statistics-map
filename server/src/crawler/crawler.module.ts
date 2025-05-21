import { Module } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { NewsModule } from '../news/news.module';
import { BBCCrawlerService } from './services/bbc-crawler.service';
import { AlJazeeraCrawlerService } from './services/al-jazeera-crawler.service';
import { ForeignPolicyCrawlerService } from './services/foreign-policy-crawler.service';
import { TheDiplomatCrawlerService } from './services/the-diplomat-crawler.service';
import { APNewsCrawlerService } from './services/ap-news-crawler.service';
import { GuardianCrawlerService } from './services/guardian-crawler.service';
import { EuronewsCrawlerService } from './services/euronews-crawler.service';

@Module({
  imports: [NewsModule],
  providers: [
    CrawlerService,
    BBCCrawlerService,
    AlJazeeraCrawlerService,
    ForeignPolicyCrawlerService,
    TheDiplomatCrawlerService,
    APNewsCrawlerService,
    GuardianCrawlerService,
    EuronewsCrawlerService,
  ],
  exports: [CrawlerService],
})
export class CrawlerModule {}
