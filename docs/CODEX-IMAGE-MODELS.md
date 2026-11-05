# 코덱스 구독 이미지 모델 확인

2026-11-05 운영 서비스와 같은 구독 연결에서 확인했습니다. 별도 유료 API 열쇠는 사용하지 않았습니다.

- 생성과 참조 이미지 편집은 정상 동작했습니다.
- `gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`, 존재하지 않는 모델명으로도 그림이 생성됐습니다. 요청 성공은 해당 모델 사용의 증거가 아닙니다.
- 응답 본문과 응답 머리글에는 실제 이미지 모델 버전이 없었습니다.
- 같은 날 확인한 공식 코덱스 소스도 이미지 요청에는 `gpt-image-2`라는 이름을 사용합니다. 이 이름만으로 실제 버전을 판단하지 않습니다.
- 공식 코덱스 요청 형식으로 움직이는 그림을 요청하면 서버가 `GIF output is not enabled for this request.`로 거절했습니다. 허용되지 않은 기능을 강제로 활성화하지 않습니다.

따라서 기본 요청 모델은 유지합니다. `effectiveImage.requestedModel`은 요청값이고, `effectiveImage.model`은 서버가 실제로 알려준 값만 기록합니다. 실제 모델이 없으면 `modelSource: "unreported"`로 저장하고 화면에는 코덱스 자동 선택으로 표시합니다. 과거 기록은 덮어쓰지 않습니다.

2.6 이름을 강제 선택하는 기능이나 새 출력 기능은 구독 연결의 지원이 확인된 뒤 추가합니다. 유료 API 경로로 자동 전환하지 않습니다.

공식 근거:

- https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
- https://github.com/openai/codex/blob/c903541/codex-rs/ext/image-generation/src/tool.rs
- https://github.com/openai/codex/blob/c903541/codex-rs/codex-api/src/images.rs
