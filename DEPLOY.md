# 배포 방법

이 프로젝트는 Flask 백엔드가 프론트엔드까지 같이 제공합니다.

## Render 배포

1. GitHub에 이 프로젝트를 올립니다.
2. Render에서 `New +` -> `Blueprint`를 선택합니다.
3. 이 저장소를 연결합니다.
4. 환경변수 `KAKAO_REST_API_KEY`에 카카오 REST API 키를 넣습니다.
5. 배포가 끝나면 Render가 만든 URL로 접속합니다.

## 로컬 실행

```powershell
$env:PORT=5001
python backend\app.py
```

브라우저에서 `http://localhost:5001`로 접속하면 프론트와 API가 같이 동작합니다.
