import { connect, model, Schema, Document } from 'mongoose';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('MongoDB에서 S3로 데이터 마이그레이션을 시작합니다...');

// MongoDB 스키마 정의 - strict: false로 설정하여 스키마에 없는 필드도 허용
const NewsSchema = new Schema(
  {
    title: String,
    content: String,
    contentKey: String,
    source: String,
    url: String,
    publishedAt: Date,
  },
  { strict: false },
);

// AWS S3 클라이언트 초기화
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const bucketName = process.env.AWS_S3_BUCKET_NAME || 'news-articles-content';

// S3에 콘텐츠 업로드 함수
async function uploadToS3(content: string, source: string): Promise<string> {
  // 고유한 키 생성 (UUID + 타임스탬프)
  const key = `articles/${source}/${uuidv4()}-${Date.now()}.txt`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: content,
    ContentType: 'text/plain',
  });

  await s3Client.send(command);
  return key;
}

// 메인 마이그레이션 함수
async function migrateToS3() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI 환경 변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    // MongoDB 연결
    console.log('MongoDB에 연결 중...');
    await connect(process.env.MONGODB_URI);
    console.log('MongoDB 연결 성공');

    // 사용자가 알려준 컬렉션 이름 직접 사용
    const collectionName = 'mongonews';
    console.log(`컬렉션 '${collectionName}'을 사용합니다.`);

    // 연결 확인
    if (!mongoose.connection || !mongoose.connection.db) {
      console.error('MongoDB 연결이 올바르게 설정되지 않았습니다.');
      process.exit(1);
    }

    // News 모델 정의 - 실제 찾은 컬렉션 이름 사용
    const NewsModel = mongoose.model('News', NewsSchema, collectionName);

    // 컬렉션에서 샘플 문서 확인
    const sampleDoc = await NewsModel.findOne().exec();
    if (sampleDoc) {
      console.log(
        '샘플 문서 구조:',
        JSON.stringify(Object.keys(sampleDoc.toObject()), null, 2),
      );
      console.log('샘플 문서:', JSON.stringify(sampleDoc.toObject(), null, 2));
    } else {
      console.log('컬렉션에 문서가 없습니다.');
      process.exit(1);
    }

    // 실제 문서에서 content 필드의 이름 확인
    const contentFieldName = Object.keys(sampleDoc.toObject()).find(
      (key) => key === 'content' || key.toLowerCase().includes('content'),
    );

    if (!contentFieldName) {
      console.error('content 관련 필드를 찾을 수 없습니다.');
      process.exit(1);
    }

    console.log(`콘텐츠 필드 이름: ${contentFieldName}`);

    // 전체 문서 수 확인
    const totalDocs = await NewsModel.countDocuments();
    console.log(`전체 문서 수: ${totalDocs}`);

    // 콘텐츠가 있는 문서 찾기 (필드 이름 동적 사용)
    const query: any = {};
    query[contentFieldName] = { $exists: true, $ne: '' };

    // contentKey 필드가 없는 문서만 조회
    const articlesToMigrate = await NewsModel.find({
      ...query,
      contentKey: { $exists: false },
    }).exec();

    console.log(`총 ${articlesToMigrate.length}개 기사를 마이그레이션합니다.`);

    // 기사가 없으면 다른 쿼리 시도
    if (articlesToMigrate.length === 0) {
      console.log('마이그레이션할 기사가 없습니다. 다른 쿼리로 시도합니다...');

      // 직접 컬렉션 접근으로 쿼리 (db가 존재함을 확인했으므로 타입 단언 사용)
      const rawCollection = mongoose.connection.db.collection(collectionName);

      // 원시 쿼리 - contentKey 필드가 없는 문서 찾기
      const rawResults = await rawCollection
        .find({
          [contentFieldName]: { $exists: true, $ne: '' },
        })
        .limit(5)
        .toArray();

      console.log(`원시 쿼리로 찾은 문서 수: ${rawResults.length}`);

      if (rawResults.length > 0) {
        console.log('- 첫 번째 문서 샘플:');
        console.log(JSON.stringify(rawResults[0], null, 2));

        // 직접 마이그레이션 진행
        console.log('컬렉션에서 직접 마이그레이션을 시도합니다...');

        let migratedCount = 0;
        let errorCount = 0;

        for (const doc of rawResults) {
          try {
            if (doc[contentFieldName]) {
              // S3에 콘텐츠 업로드
              const contentKey = await uploadToS3(
                doc[contentFieldName],
                doc.source || 'unknown',
              );

              // 기사 업데이트: 콘텐츠 키 추가, 콘텐츠는 축소하여 저장
              const truncatedContent =
                doc[contentFieldName].length > 200
                  ? doc[contentFieldName].substring(0, 200) + '...'
                  : doc[contentFieldName];

              await rawCollection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    contentKey: contentKey,
                    [contentFieldName]: truncatedContent,
                  },
                },
              );

              migratedCount++;
              console.log(`문서 ID ${doc._id} 마이그레이션 완료`);
            }
          } catch (error) {
            errorCount++;
            console.error(`문서 ID ${doc._id} 마이그레이션 중 오류:`, error);
          }
        }

        console.log(
          `샘플 마이그레이션 완료: 성공 ${migratedCount}, 실패 ${errorCount}`,
        );

        // 성공했다면 전체 마이그레이션을 위한 안내
        if (migratedCount > 0) {
          console.log('');
          console.log('=== 마이그레이션 안내 ===');
          console.log('샘플 마이그레이션이 성공적으로 완료되었습니다.');
          console.log(
            '전체 마이그레이션을 진행하려면 아래 수정된 스크립트를 사용하세요:',
          );
          console.log('');
          console.log(`컬렉션 이름: ${collectionName}`);
          console.log(`콘텐츠 필드 이름: ${contentFieldName}`);
          console.log('');
        }

        process.exit(0);
      }
    }

    let migratedCount = 0;
    let errorCount = 0;

    // 각 문서 처리
    for (const article of articlesToMigrate) {
      try {
        if (article[contentFieldName]) {
          // S3에 콘텐츠 업로드
          const contentKey = await uploadToS3(
            article[contentFieldName],
            article.source || 'unknown',
          );

          // 기사 업데이트: 콘텐츠 키 추가, 콘텐츠는 축소하여 저장
          const truncatedContent =
            article[contentFieldName].length > 200
              ? article[contentFieldName].substring(0, 200) + '...'
              : article[contentFieldName];

          const update: any = { contentKey: contentKey };
          update[contentFieldName] = truncatedContent;

          await NewsModel.updateOne({ _id: article._id }, { $set: update });

          migratedCount++;

          if (migratedCount % 10 === 0) {
            console.log(
              `${migratedCount}/${articlesToMigrate.length} 기사 마이그레이션 완료`,
            );
          }
        }
      } catch (error) {
        errorCount++;
        console.error(`기사 ID ${article._id} 마이그레이션 중 오류:`, error);
      }
    }

    console.log(`마이그레이션 완료: 성공 ${migratedCount}, 실패 ${errorCount}`);
  } catch (error) {
    console.error('마이그레이션 중 오류 발생:', error);
  } finally {
    // 연결 종료
    process.exit(0);
  }
}

// 스크립트 실행
migrateToS3();
