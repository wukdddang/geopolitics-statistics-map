import { Module } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [NewsModule],
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
