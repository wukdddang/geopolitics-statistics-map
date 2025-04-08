import { connect } from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('MongoDB에서 content 필드 삭제 작업을 시작합니다...');

// MongoDB 일괄 작업 타입 정의
type BulkWriteOperation = {
  updateOne: {
    filter: { _id: any };
    update: { $unset: { content: string } };
  };
};

// 메인 함수
async function removeContentField() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI 환경 변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    // MongoDB 연결
    console.log('MongoDB에 연결 중...');
    await connect(process.env.MONGODB_URI);
    console.log('MongoDB 연결 성공');

    // 연결 확인
    if (!mongoose.connection || !mongoose.connection.db) {
      console.error('MongoDB 연결이 올바르게 설정되지 않았습니다.');
      process.exit(1);
    }

    // 컬렉션 이름
    const collectionName = 'mongonews';
    console.log(`컬렉션 '${collectionName}'을 사용합니다.`);

    // 컬렉션에 직접 접근
    const collection = mongoose.connection.db.collection(collectionName);

    // 전체 문서 수 조회
    const totalCount = await collection.countDocuments();
    console.log(`총 문서 수: ${totalCount}`);

    // contentKey가 있는 문서 수 조회 (마이그레이션된 문서)
    const migratedCount = await collection.countDocuments({
      contentKey: { $exists: true, $ne: '' },
    });
    console.log(`마이그레이션된 문서 수: ${migratedCount}`);

    if (migratedCount === 0) {
      console.log(
        '마이그레이션된 문서가 없습니다. 콘텐츠 삭제를 진행할 수 없습니다.',
      );
      process.exit(0);
    }

    console.log('정말로 모든 문서의 content 필드를 삭제하시겠습니까?');
    console.log(
      '이 작업은 되돌릴 수 없으며, S3에 콘텐츠가 올바르게 저장되었는지 확인해야 합니다.',
    );
    console.log('진행하려면 이 코드에서 아래 주석을 제거하고 다시 실행하세요.');

    // 안전 잠금 장치 - 주석을 제거하여 실행
    console.log('content 필드 삭제 작업을 시작합니다...');

    // 첫 번째 단계: contentKey가 있는 문서 (이미 마이그레이션된 문서)의 content 필드 비우기
    console.log('content 필드를 삭제 중입니다...');

    // 배치 처리를 위한 변수
    const batchSize = 100;
    let processedCount = 0;
    let cursor = collection.find({ contentKey: { $exists: true, $ne: '' } });

    // 커서를 사용하여 대량의 문서 처리
    let batch: BulkWriteOperation[] = [];

    for await (const doc of cursor) {
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $unset: { content: '' } }, // content 필드 완전히 제거
        },
      });

      // 배치가 일정 크기에 도달하면 처리
      if (batch.length >= batchSize) {
        await collection.bulkWrite(batch);
        processedCount += batch.length;
        console.log(`${processedCount}/${migratedCount} 문서 처리 완료`);
        batch = [];
      }
    }

    // 남은 배치 처리
    if (batch.length > 0) {
      await collection.bulkWrite(batch);
      processedCount += batch.length;
      console.log(`${processedCount}/${migratedCount} 문서 처리 완료`);
    }

    console.log(`콘텐츠 필드 삭제 완료: ${processedCount} 문서 처리됨`);

    console.log('content 필드 삭제 작업 준비가 완료되었습니다.');
    console.log('스크립트를 수정하여 안전 잠금장치를 제거한 후 실행하세요.');
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    // 연결 종료
    process.exit(0);
  }
}

// 스크립트 실행
removeContentField();
