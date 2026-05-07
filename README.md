<span align="center">

# homebridge-xiaomi-fan-km81

[![npm](https://badgen.net/npm/v/homebridge-xiaomi-fan-km81?icon=npm)](https://www.npmjs.com/package/homebridge-xiaomi-fan-km81)
[![mit-license](https://badgen.net/badge/license/MIT/blue)](https://github.com/Km81/homebridge-xiaomi-fan-km81/blob/master/LICENSE)

</span>

> 본 프로젝트는 [merdok/homebridge-xiaomi-fan](https://github.com/merdok/homebridge-xiaomi-fan)을 fork하여 **Homebridge 2.0 호환성**을 맞춘 버전입니다. 원작자(Marcin)의 라이선스(MIT)를 그대로 따르며, 핵심 기능은 동일합니다.

`homebridge-xiaomi-fan-km81`은 Xiaomi Smartmi / Mija 선풍기를 HomeKit으로 제어할 수 있게 해주는 Homebridge 플러그인입니다. 대부분의 Xiaomi 스마트 선풍기에서 동작하며, iOS 홈 앱과 Siri로 선풍기를 자유롭게 조작할 수 있도록 하는 것이 목표입니다.

## 주요 기능

- HomeKit에 선풍기(Fan) 액세서리로 통합
- 전원 / 풍량 / 회전 모드 / 자연풍 모드 제어
- 회전 각도 설정
- 좌/우 5° 단위로 머리 위치 이동
- 부저(소리) 켜기/끄기
- LED 켜기/끄기
- 자동 꺼짐 타이머 설정
- HomeKit 자동화 연동

## 지원 모델

다음 모델에서 동작이 확인되었습니다:

- zhimi.fan.sa1 (Mi Standing Fan)
- zhimi.fan.v2 / v3 (Smartmi DC Pedestal Fan)
- zhimi.fan.za1 (Smartmi Inverter Pedestal Fan)
- zhimi.fan.za3 (Smartmi Standing Fan 2)
- zhimi.fan.za4 (Smartmi Standing Fan 2S)
- zhimi.fan.za5 (Smartmi Standing Fan 3)
- zhimi.fan.fa1 (Mijia DC Circulating Fan)
- zhimi.fan.fb1 (Mi Smart Air Circulator Fan)
- dmaker.fan.1c (Mi Smart Standing Fan 1C)
- dmaker.fan.p5 (Mi Smart Standing Fan 1X)
- dmaker.fan.p8 (Mi Smart Standing Fan 1C CN)
- dmaker.fan.p9 (Mi Smart Tower Fan)
- dmaker.fan.p10 (Mi Smart Standing Fan 2)
- dmaker.fan.p11 (Mi Smart Standing Fan Pro)
- dmaker.fan.p15 (Mi Smart Standing Fan Pro EU)
- dmaker.fan.p18 (Mi Smart Fan 2)
- air.fan.ca23ad9 (AIRMATE CA23-AD9 Air Circulation Fan)
- dmaker.fan.p30 (Xiaomi Smart Standing Fan 2)
- dmaker.fan.p33 (Xiaomi Smart Standing Fan 2 Pro)
- dmaker.fan.p220 (Mijia DC Inverter Circulating Floor Fan)

## 설치

Homebridge가 처음이라면 먼저 [Homebridge 공식 문서](https://www.npmjs.com/package/homebridge)를 읽어주세요. Raspberry Pi 환경이라면 [Homebridge Wiki의 설치 가이드](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Raspbian)에 자세한 안내가 있습니다.

Homebridge 설치:

```sh
sudo npm install -g homebridge
```

본 플러그인 설치:

```sh
sudo npm install -g homebridge-xiaomi-fan-km81
```

> Homebridge UI를 사용하는 경우 플러그인 검색에서 **homebridge-xiaomi-fan-km81**을 찾아 설치하면 됩니다.

## 설정

`.homebridge` 디렉터리의 `config.json` 파일에 `xiaomifan` 플랫폼을 추가합니다. 선풍기 1대 또는 여러 대를 `devices` 배열에 등록할 수 있습니다.

설정 예시:

```json
{
  "platforms": [
    {
      "platform": "xiaomifan",
      "devices": [
        {
          "name": "거실 샤오미 선풍기",
          "ip": "192.168.0.40",
          "token": "8305d8fba83f94bb5ad8f963b6c84c84",
          "pollingInterval": 10,
          "moveControl": true,
          "buzzerControl": true,
          "ledControl": true,
          "naturalModeControl": true,
          "shutdownTimer": true,
          "angleButtons": [5, 60, 100]
        }
      ]
    }
  ]
}
```

### 토큰 얻기

플러그인이 동작하려면 선풍기의 **device token**이 반드시 필요합니다. 토큰을 얻는 방법은 [Mi 디바이스 토큰 가이드](https://github.com/jghaanstra/com.xiaomi-miio/blob/master/docs/obtain_token.md)를 참고하세요.

좀 더 간편하게 추출하고 싶다면 [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor) 도구를 추천합니다.

### 설정 항목

#### 플랫폼 단위 설정

| 항목         | 필수 | 설명                                       |
| ------------ | ---- | ------------------------------------------ |
| `platform`   | 필수 | 항상 `"xiaomifan"` 으로 지정               |
| `devices` (또는 `fans`) | 필수 | 선풍기 목록 배열               |

#### 선풍기 단위 설정

- **`name`** (필수) — HomeKit에 표시될 액세서리 이름.
- **`ip`** (필수) — 선풍기의 IP 주소.
- **`token`** (필수) — 선풍기 device token.
- **`deviceId`** (선택) — miot 프로토콜을 사용하는 신형 선풍기는 device id가 필요합니다. 자동으로 가져오지만 인식이 안 될 경우 수동 입력. **기본값:** `""` (자동)
- **`model`** (선택) — 선풍기 모델명을 직접 지정. 지정하면 디스커버리 과정 없이 바로 액세서리가 생성됩니다. **기본값:** `""` (자동 감지)
- **`prefsDir`** (선택) — 선풍기 정보를 저장할 폴더 경로. **기본값:** `~/.homebridge/.xiaomiFan`
- **`pollingInterval`** (선택) — 상태 폴링 주기(초). **기본값:** `5`
- **`deepDebugLog`** (선택) — 상세 디버그 로그 출력. **기본값:** `false`
- **`buzzerControl`** (선택) — 부저(소리) 켜기/끄기 버튼 표시. Smartmi 계열은 회전 방향 스위치로 큰 소리/작은 소리 전환 가능. **기본값:** `true`
- **`ledControl`** (선택) — LED 켜기/끄기 버튼 표시. **기본값:** `true`
- **`naturalModeControl`** (선택) — 자연풍 모드 스위치 표시. 지원 모델 한정. **기본값:** `true`
- **`sleepModeControl`** (선택) — 수면 모드 스위치 표시. 지원 모델 한정. **기본값:** `true`
- **`moveControl`** (선택) — 좌/우 5° 이동 스위치 표시. 지원 모델 한정. **기본값:** `false`
- **`shutdownTimer`** (선택) — 자동 꺼짐 타이머(분 단위)를 슬라이더(전구 형태)로 표시. **기본값:** `false`
- **`angleButtons`** (선택) — 회전 각도 전환용 버튼 생성. 지원 모델 한정.
  - 정수 배열로 입력 (예: `[30, 60, 90]`). 사용 가능한 각도 값은 모델마다 다릅니다.
  - 일부 모델은 사전 정의된 각도 버튼이 있어 이 값을 비워두면 자동으로 가져와 표시합니다. 자동 표시를 막으려면 `[]` 또는 `false`로 설정.
  - 활성화된 각도 버튼을 한 번 더 누르면 회전이 꺼집니다.
  - **기본값:** `""` (비활성)
- **`verticalAngleButtons`** (선택) — 수직(상하) 회전 각도 버튼. 지원 모델 한정. 동작 방식은 `angleButtons`와 동일. **기본값:** `""` (비활성)
- **`ioniserControl`** (선택) — 이온 발생기 켜기/끄기 스위치 표시. 지원 모델 한정. **기본값:** `false`
- **`fanLevelControl`** (선택) — 풍량 단계 스위치 표시. 지원 모델 한정. **기본값:** `true`

## 문제 해결

플러그인이나 선풍기 동작에 문제가 있다면 Homebridge를 디버그 모드로 실행해 추가 정보를 확인할 수 있습니다.

```sh
homebridge -D
```

config.json에 다음을 추가하면 더 상세한 로그를 확인할 수 있습니다:

```json
"deepDebugLog": true
```

이렇게 하면 다양한 문제를 분석하는 데 도움이 되는 추가 로그가 출력됩니다.

## 기여 / 이슈

이 fork에서 발견한 버그나 개선 요청은 [본 저장소의 Issues](https://github.com/Km81/homebridge-xiaomi-fan-km81/issues)에 등록해주세요. 원본 플러그인의 동작 자체에 관련된 이슈라면 [원본 저장소](https://github.com/merdok/homebridge-xiaomi-fan)에도 공유 가능합니다.

## 감사의 말

- [merdok](https://github.com/merdok) — 원작자(Marcin)께 감사드립니다. 이 fork는 원작 코드를 기반으로 합니다.
- [miio](https://github.com/aholstenson/miio) — Xiaomi Mi 디바이스를 제어하기 위한 Node.js 모듈.
- [HAP-NodeJS](https://github.com/KhaosT/HAP-NodeJS) & [Homebridge](https://github.com/nfarina/homebridge) — 이 모든 걸 가능하게 해준 프로젝트들.
