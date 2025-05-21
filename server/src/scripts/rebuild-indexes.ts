import { connect } from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('MongoDB 인덱스 최적화를 시작합니다...');

async function rebuildIndexes() {
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

    // 현재 인덱스 조회
    console.log('현재 인덱스 정보 조회 중...');
    const currentIndexes = await collection.indexes();
    console.log('현재 인덱스 목록:');
    console.log(JSON.stringify(currentIndexes, null, 2));

    // 모든 인덱스 제거 (ID 인덱스 제외)
    console.log('기존 인덱스 제거 중...');
    for (const index of currentIndexes) {
      if (index.name !== '_id_') {
        // TypeScript 오류 수정: name이 undefined일 수 있으므로 타입 체크
        const indexName = index.name;
        if (indexName) {
          await collection.dropIndex(indexName);
          console.log(`인덱스 '${indexName}' 제거됨`);
        }
      }
    }

    // URL 고유성 인덱스 생성
    console.log('URL 고유성 인덱스 생성 중...');
    await collection.createIndex({ url: 1 }, { unique: true });
    console.log('URL 인덱스 생성 완료');

    // 타이틀만 텍스트 인덱스로 설정 (content 제외)
    console.log('제목 텍스트 인덱스 생성 중...');
    await collection.createIndex({ title: 'text' });
    console.log('제목 텍스트 인덱스 생성 완료');

    // 소스 및 날짜 검색을 위한 인덱스
    console.log('소스 및 날짜 인덱스 생성 중...');
    await collection.createIndex({ source: 1, publishedAt: -1 });
    console.log('소스 및 날짜 인덱스 생성 완료');

    // 완료 후 인덱스 통계 확인
    console.log('인덱스 최적화 완료. 새 인덱스 정보:');
    const newIndexes = await collection.indexes();
    console.log(JSON.stringify(newIndexes, null, 2));

    // 인덱스 통계 조회
    const stats = await mongoose.connection.db.command({
      collStats: collectionName,
    });
    console.log('\n컬렉션 통계:');
    console.log(`저장 크기: ${formatBytes(stats.storageSize)}`);
    console.log(`인덱스 크기: ${formatBytes(stats.totalIndexSize)}`);
    console.log(`문서 수: ${stats.count}`);
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    console.log('인덱스 최적화 작업 완료');
    process.exit(0);
  }
}

// 바이트 크기를 읽기 쉬운 형식으로 변환
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 스크립트 실행
rebuildIndexes();
