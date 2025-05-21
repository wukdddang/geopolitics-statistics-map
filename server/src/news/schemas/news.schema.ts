import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { GeopoliticalData } from '../interfaces/news.interface';

export type NewsDocument = MongoNews & Document;

@Schema()
export class MongoNews {
  @Prop({ required: true })
  title: string;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false })
  contentKey: string;

  @Prop({ required: true })
  source: string;

  @Prop({ required: true, unique: true })
  url: string;

  @Prop()
  author: string;

  @Prop([String])
  tags: string[];

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ required: true })
  publishedAt: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop({ type: [String] })
  entities: string[];

  @Prop({ type: Object })
  geopoliticalData: GeopoliticalData;
}

export const NewsSchema = SchemaFactory.createForClass(MongoNews);

// 텍스트 검색을 위한 인덱스 추가 - content 대신 title만 사용
NewsSchema.index({ title: 'text' });

// URL 중복 방지를 위한 인덱스
NewsSchema.index({ url: 1 }, { unique: true });
