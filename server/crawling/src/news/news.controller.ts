import { Controller, Get, Param, Query } from '@nestjs/common';
import { NewsService } from './news.service';
import { NewsDocument } from './schemas/news.schema';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  async findAll(): Promise<NewsDocument[]> {
    return this.newsService.findAll();
  }

  @Get('search')
  async search(@Query('q') query: string): Promise<NewsDocument[]> {
    return this.newsService.search(query);
  }

  @Get('source/:source')
  async findBySource(@Param('source') source: string): Promise<NewsDocument[]> {
    return this.newsService.findBySource(source);
  }

  @Get('geopolitical')
  async getGeopoliticalEvents(): Promise<NewsDocument[]> {
    return this.newsService.getGeopoliticalEvents();
  }

  @Get('country/:country')
  async findByCountry(
    @Param('country') country: string,
  ): Promise<NewsDocument[]> {
    return this.newsService.findByCountry(country);
  }

  @Get('statistics')
  async getStatistics() {
    return this.newsService.getStatistics();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<NewsDocument | null> {
    return this.newsService.findOne(id);
  }

  @Get(':id/content')
  async getFullContent(@Param('id') id: string): Promise<{ content: string }> {
    const content = await this.newsService.getFullContent(id);
    return { content };
  }

  @Get(':id/content-url')
  async getContentUrl(@Param('id') id: string): Promise<{ url: string }> {
    const url = await this.newsService.getContentUrl(id);
    return { url };
  }
}
