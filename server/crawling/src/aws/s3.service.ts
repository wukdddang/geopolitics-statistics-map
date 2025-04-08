import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    // AWS 자격 증명은 환경 변수 또는 AWS 기본 자격 증명 공급자 체인을 통해 제공됩니다
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-northeast-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || 'news-articles-content';
  }

  // 콘텐츠를 S3에 저장하고 키 반환
  async uploadContent(content: string, source: string): Promise<string> {
    try {
      // 고유한 키 생성 (UUID + 타임스탬프)
      const key = `articles/${source}/${uuidv4()}-${Date.now()}.txt`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: content,
        ContentType: 'text/plain',
      });

      await this.s3Client.send(command);
      this.logger.log(`콘텐츠가 S3에 업로드되었습니다: ${key}`);

      return key;
    } catch (error) {
      this.logger.error(`S3 업로드 오류: ${error.message}`);
      throw error;
    }
  }

  // S3에서 콘텐츠 가져오기
  async getContent(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return (await response.Body?.transformToString()) || '';
    } catch (error) {
      this.logger.error(`S3에서 콘텐츠 가져오기 오류: ${error.message}`);
      throw error;
    }
  }

  // 서명된 URL 생성 (임시 액세스)
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(`서명된 URL 생성 오류: ${error.message}`);
      throw error;
    }
  }

  // S3에서 콘텐츠 삭제
  async deleteContent(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`콘텐츠가 S3에서 삭제되었습니다: ${key}`);
    } catch (error) {
      this.logger.error(`S3 콘텐츠 삭제 오류: ${error.message}`);
      throw error;
    }
  }
}
