# 테스트와 빌드

권장 로컬 버전은 Node.js 24 LTS입니다(`.nvmrc`). CI는 Node.js 22와 24에서 각각 설치, 테스트, 빌드를 수행합니다. 22 계열은 22.12 이상을 사용하세요. 기존 `@vitejs/plugin-react-swc@4.0.1`의 요구 조건은 `^20.19.0 || >=22.12.0`이며, 동기화된 잠금 파일의 Supabase 패키지는 Node.js 22 이상을 요구합니다. Node.js 18/20을 이 구성의 검증 대상으로 사용하지 않습니다.

```sh
npm ci
npm test
npm run build
```

개발 중 저장할 때마다 다시 검사하려면 `npm run test:watch`를 실행하세요. 종료는 Ctrl+C입니다. 테스트는 Node 내장 `node:test`, `t.mock.method`, `fetch`, `Headers`, `Response.json`을 사용하며 별도의 테스트 프레임워크는 없습니다.

## 외부 API 없는 검증

`test/search-mixed.test.js`는 `api/search-mixed.js`를 모의 요청·응답으로 실행합니다. Google/Naver 인증값은 테스트용 가짜 문자열이며 GitHub Secrets, 실제 API 키 또는 `.env.local`이 필요하지 않습니다. 핸들러를 가져올 때 dotenv의 파일 읽기를 대체하고, 각 테스트에서 fetch를 모의 구현으로 대체합니다. 테스트 종료 시 환경변수와 mock은 복구됩니다.

17개 테스트가 다음을 확인합니다.

- Google/Naver 요청 매개변수·인증 헤더·리다이렉트 거부 옵션
- 검색 결과 정규화, Google 뉴스 도메인 필터, URL 끝 `/` 중복 제거, 날짜 정렬, 최대 10개
- 한쪽 또는 양쪽 HTTP 오류와 정상 제공자의 부분 결과
- fetch 예외 및 AbortError의 고정 오류 응답(실제 12초 타이머 경과를 재현하는 테스트는 아님)
- 검색어 누락, 전체/부분 환경설정 누락, 빈 결과
- 잘못된 Google JSON은 500, 잘못된 Naver JSON은 빈 결과로 처리하는 기존 동작
- 성공 기사·오류 응답에 인증정보 원문 및 URL 인코딩 값이 노출되지 않음
- 성공 응답에 debug URL 또는 제공자 내부 메타데이터가 없음

## GitHub Actions

`.github/workflows/test.yml`은 push, pull request, 수동 실행에서 작동합니다. 각 Node 버전에 대해 `npm ci --no-audit --no-fund` → `npm test` → `npm run build` 순서로 실행되며 앞 단계 실패 시 다음 단계는 진행하지 않습니다. 의존성 설치에는 인터넷이 필요하지만 검색 테스트는 외부 API에 접속하지 않습니다.

권한은 `contents: read`이며 checkout 인증정보를 유지하지 않습니다. checkout/setup-node는 확인한 v6 커밋 SHA로 고정했습니다. npm 캐시는 `package-lock.json`을 기준으로 사용합니다. 브랜치 보호의 필수 검사 지정은 별도 저장소 설정이며 이 파일만으로 설정되지 않습니다.

## 잠금 파일 동기화

기존 `package.json`에 있는 `@supabase/supabase-js`와 `react-router-dom`이 기존 `package-lock.json`에는 빠져 있어 `npm ci`가 실패했습니다. 기존 잠금 항목의 버전은 유지하고 누락된 두 패키지 및 전이 의존성을 추가했습니다. 새로 잠긴 직접 의존성은 각각 2.119.0, 7.18.5이며 기존 package.json의 허용 범위 안에 있습니다. 기존 배포가 실제로 사용한 해석 버전과 같은지는 확인하지 않았습니다.

## 검증의 범위

이 테스트는 혼합 검색 핸들러의 회귀 검사입니다. 실제 검색 공급자의 인증·가용성, 브라우저 UI, 로그인/DB 연동, 다른 API 엔드포인트, 배포 환경변수는 검증하지 않습니다. 프로덕션 빌드 성공도 이러한 실서비스 동작의 보장은 아닙니다.

공식 참고: [Node.js 테스트 러너](https://nodejs.org/docs/latest-v24.x/api/test.html), [Node.js 릴리스](https://nodejs.org/en/about/previous-releases), [setup-node](https://github.com/actions/setup-node), [checkout](https://github.com/actions/checkout).
