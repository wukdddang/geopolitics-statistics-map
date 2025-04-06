# 지정학 뉴스 크롤링 서버

지정학 이벤트들을 자동으로 수집하고 분석하는 NestJS 기반 서버입니다. 전 세계 뉴스 기사를 크롤링하여 PostgreSQL과 MongoDB에 저장합니다.

## 기능

- 다양한 뉴스 소스에서 자동으로 기사 크롤링
- 크롤링한 데이터 PostgreSQL에 기본 저장
- 추가 메타데이터와 지정학적 분석 데이터는 MongoDB에 저장
- 스케줄링된 자동 크롤링 (기본 6시간마다)
- 수동 크롤링 요청 API 제공
- 다양한 검색 및 필터링 기능 제공

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

## 설치 및 실행

```bash
# 패키지 설치
pnpm install

# 개발 모드로 실행
pnpm run start:dev

# 프로덕션 모드로 빌드
pnpm run build

# 프로덕션 모드로 실행
pnpm run start:prod
```

## API 사용법

### 뉴스 목록 조회

```
GET /news
```

### 뉴스 검색

```
GET /news/search?q=검색어
```

### 소스별 뉴스 조회

```
GET /news/source/:source
```

### 지정학적 이벤트 조회

```
GET /news/geopolitical
```

### 수동 크롤링 시작

```
POST /scheduler/crawl
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
