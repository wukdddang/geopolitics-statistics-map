# 뉴스 크롤링 및 데이터 저장 서비스

## 설명

이 프로젝트는 주요 국제 뉴스 사이트에서 기사를 크롤링하여 MongoDB에 저장하고, 기사 내용은 AWS S3에 저장하는 NestJS 기반 애플리케이션입니다.

## 설치

```bash
# 패키지 설치
$ pnpm install
```

## 구성

1. `.env` 파일 생성 및 환경 변수 설정
   - `.env.example` 파일을 `.env`로 복사하고 필요한 정보 입력

```
# MongoDB 연결 설정
MONGODB_URI=mongodb+srv://username:password@host/database

# 크롤링 스케줄 설정 (cron 형식)
CRAWL_SCHEDULE=0 */6 * * *  # 6시간마다 실행

# AWS S3 설정
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET_NAME=news-articles-content
```

2. AWS S3 버킷 생성
   - AWS 콘솔에서 S3 버킷 생성 (`news-articles-content` 또는 원하는 이름)
   - 올바른 권한 설정 (비공개 권한 권장)

## 실행 방법

```bash
# 개발 모드
$ pnpm run start:dev

# 프로덕션 모드로 빌드
$ pnpm run build

# 프로덕션 모드로 실행
$ pnpm run start:prod
```

## MongoDB에서 S3로 마이그레이션

기존 MongoDB에 저장된 모든 기사의 내용을 S3로 이전하고 MongoDB에는 참조 URL만 저장하려면 다음 명령어를 실행하세요:

```bash
# 마이그레이션 스크립트 실행
$ pnpm run migrate:s3
```

마이그레이션 후:

- 기사 전체 내용은 S3에 저장됩니다.
- MongoDB에는 기사 제목, URL 등의 메타데이터와 S3 콘텐츠 키가 저장됩니다.
- 콘텐츠는 200자로 잘린 요약본만 MongoDB에 저장됩니다.

## API 엔드포인트

- `GET /news`: 모든 뉴스 기사 목록 조회
- `GET /news/search?q=query`: 기사 검색
- `GET /news/source/:source`: 특정 소스의 기사 조회
- `GET /news/:id`: 특정 ID의 기사 조회
- `GET /news/:id/content`: 기사 전체 내용 조회 (S3에서 가져옴)
- `GET /news/:id/content-url`: 기사 내용에 대한 임시 접근 URL 생성 (유효기간: 1시간)

## 사용된 기술

- NestJS
- TypeORM (PostgreSQL)
- Mongoose (MongoDB)
- cheerio (웹 크롤링)
- axios (HTTP 요청)
- 스케줄러 (자동 크롤링)

## 데이터베이스 설정

### PostgreSQL

```bash
# PostgreSQL 설치 및 실행 (Docker 사용 예시)
docker run --name postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=geopolitics -p 5432:5432 -d postgres
```

### MongoDB

```bash
# MongoDB 설치 및 실행 (Docker 사용 예시)
docker run --name mongodb -p 27017:27017 -d mongo
```

## 크롤링 소스

현재 다음 뉴스 소스에서 기사를 수집합니다:

1. Reuters World
2. BBC World
3. Al Jazeera
4. Foreign Policy
5. The Diplomat

추가적인 소스는 `CrawlerService`의 `sources` 배열에 추가할 수 있습니다.

## 환경 변수

`.env` 파일에서 다음 환경 변수를 설정할 수 있습니다:

- `PORT`: 서버 포트 (기본값: 3001)
- `POSTGRES_HOST`: PostgreSQL 호스트
- `POSTGRES_PORT`: PostgreSQL 포트
- `POSTGRES_USER`: PostgreSQL 사용자명
- `POSTGRES_PASSWORD`: PostgreSQL 비밀번호
- `POSTGRES_DB`: PostgreSQL 데이터베이스 이름
- `MONGODB_URI`: MongoDB 연결 URI
- `CRAWL_INTERVAL`: 크롤링 간격 (시간 단위, 기본값: 6)
