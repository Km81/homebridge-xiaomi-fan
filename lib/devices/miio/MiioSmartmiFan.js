const MiioFan = require('./MiioFan.js');
const FanCapabilities = require('../../FanCapabilities.js');

class MiioSmartmiFan extends MiioFan {
  constructor(miioDevice, model, deviceId, name, log) {
    super(miioDevice, model, deviceId, name, log);
  }


  /*----------========== INIT ==========----------*/

  initFanCapabilities() {
    this.addCapability(FanCapabilities.POWER_CONTROL, true);
    this.addCapability(FanCapabilities.FAN_SPEED_CONTROL, true);
    this.addCapability(FanCapabilities.FAN_LEVEL_CONTROL, true);
    this.addCapability(FanCapabilities.NUMBER_OF_FAN_LEVELS, 4);
    this.addCapability(FanCapabilities.OSCILLATION_CONTROL, true);
    this.addCapability(FanCapabilities.OSCILLATION_ANGLE_CONTROL, true);
    this.addCapability(FanCapabilities.OSCILLATION_ANGLE_RANGE, [0, 120]);
    this.addCapability(FanCapabilities.LEFT_RIGHT_MOVE, true);
    this.addCapability(FanCapabilities.NATURAL_MODE, true);
    this.addCapability(FanCapabilities.CHILD_LOCK, true);
    this.addCapability(FanCapabilities.POWER_OFF_TIMER, true);
    this.addCapability(FanCapabilities.POWER_OFF_TIMER_UNIT, 'seconds');
    this.addCapability(FanCapabilities.BUZZER_CONTROL, true);
    this.addCapability(FanCapabilities.BUZZER_LEVEL_CONTROL, true);
    this.addCapability(FanCapabilities.BUZZER_LEVELS, [0, 1, 2]);
    this.addCapability(FanCapabilities.LED_CONTROL, true);
    this.addCapability(FanCapabilities.LED_LEVEL_CONTROL, true);
    this.addCapability(FanCapabilities.LED_LEVELS, [0, 1, 2]);
    this.addCapability(FanCapabilities.USE_TIME_REPORTING, true);
    this.addCapability(FanCapabilities.BUILT_IN_BATTERY, true);
  }


  /*----------========== SETUP ==========----------*/

  addFanProperties() {
    // define the fan properties
    this.miioFanDevice.defineProperty('angle');
    this.miioFanDevice.defineProperty('speed');
    this.miioFanDevice.defineProperty('poweroff_time');
    this.miioFanDevice.defineProperty('power');
    this.miioFanDevice.defineProperty('ac_power');
    this.miioFanDevice.defineProperty('angle_enable');
    this.miioFanDevice.defineProperty('speed_level');
    this.miioFanDevice.defineProperty('natural_level');
    this.miioFanDevice.defineProperty('child_lock');
    this.miioFanDevice.defineProperty('buzzer');
    this.miioFanDevice.defineProperty('led_b');
    this.miioFanDevice.defineProperty('use_time');
  }


  /*----------========== STATUS ==========----------*/

  isPowerOn() {
    return this.getFanProperties().power === 'on';
  }

  getRotationSpeed() {
    let rotationValue = this.getFanProperties().speed_level;
    if (this.getFanProperties().natural_level > 0) {
      rotationValue = this.getFanProperties().natural_level;
    }
    return this.getSafePropertyValue(rotationValue, 0);
  }

  getSpeed() {
    return this.getSafePropertyValue(this.getFanProperties().speed, 0);
  }

  isChildLockActive() {
    return this.getFanProperties().child_lock === 'on';
  }

  isSwingModeEnabled() {
    return this.getFanProperties().angle_enable === 'on';
  }

  getAngle() {
    return this.getFanProperties().angle;
  }

  isNaturalModeEnabled() {
    return this.getFanProperties().natural_level > 0;
  }

  getBuzzerLevel() {
    return this.getFanProperties().buzzer;
  }

  isBuzzerEnabled() {
    return this.getBuzzerLevel() > 0;
  }

  getLedLevel() {
    return this.getFanProperties().led_b;
  }

  isLedEnabled() {
    return this.getLedLevel() === 0 || this.getLedLevel() === 1;
  }

  getShutdownTimer() {
    return Math.ceil(this.getFanProperties().poweroff_time / 60); // return in minutes, rounded up
  }

  isShutdownTimerEnabled() {
    return this.getShutdownTimer() > 0;
  }

  getUseTime() {
    return this.getFanProperties().use_time;
  }


  /*----------========== COMMANDS ==========----------*/

  // 자연풍(natural) 모드에서 펌웨어가 임의의 1~100 퍼센트 값을 자체적으로
  // 4단계로 반올림하지 않는 구형 Smartmi 모델 목록.
  // - zhimi.fan.za4: 펌웨어가 알아서 4단계로 매핑해 주므로 손댈 필요 없음.
  // - zhimi.fan.v2 / v3 / sa1 / za1 / za3: 자연풍에서 25/50/75/100 같은 이산
  //   값이 아닐 경우 무시되어 속도 변경이 일어나지 않는다.
  _needsDiscreteNaturalLevels() {
    const model = this.getFanModel() || this.model || '';
    return (
      model === 'zhimi.fan.v2' ||
      model === 'zhimi.fan.v3' ||
      model === 'zhimi.fan.sa1' ||
      model === 'zhimi.fan.za1' ||
      model === 'zhimi.fan.za3'
    );
  }

  // 홈킷의 0~100% 슬라이더 값을 자연풍 4단계(25/50/75/100)로 스냅.
  // 0은 그대로 0(= 자연풍 OFF 의미)으로 유지.
  _mapToDiscreteNaturalLevel(percent) {
    if (percent <= 0) return 0;
    if (percent <= 25) return 25;
    if (percent <= 50) return 50;
    if (percent <= 75) return 75;
    return 100;
  }

  async setPowerOn(power) {
    let powerState = power ? 'on' : 'off';
    this.updateProperty('power', powerState);
    // refreshDelay 기본값(200ms)은 set_power 직후 다시 폴링할 때 펌웨어가
    // 아직 상태 전이가 안 끝난 시점이라, 일시적으로 power='off'(또는
    // 이전 값)로 답해 홈킷 아이콘이 잠깐 OFF로 깜빡이는 원인이 된다.
    // 1000ms로 늘려 펌웨어가 안정적으로 새 상태를 보고하도록 한다.
    return this.sendCommand('set_power', powerState, ['power', 'ac_power'], 1000);
  }

  async setRotationSpeed(speed) {
    let setMethod = this.isNaturalModeEnabled() ? 'set_natural_level' : 'set_speed_level';
    let targetSpeed = speed;
    // 자연풍 + 구형 모델(zhimi.fan.v3 등)인 경우, 임의의 퍼센트가 아니라
    // 4단계 이산값(25/50/75/100)으로 변환해서 보내야 실제로 속도가 변한다.
    if (this.isNaturalModeEnabled() && this._needsDiscreteNaturalLevels()) {
      targetSpeed = this._mapToDiscreteNaturalLevel(speed);
    }
    this.updateFanMode(this.isNaturalModeEnabled(), targetSpeed); // update the fan mode instantly, do not wait for miio refresh, this improves scenes
    return this.sendCommand(setMethod, targetSpeed, ['speed_level', 'natural_level']);
  }

  async setChildLock(active) {
    let state = active ? 'on' : 'off';
    this.updateProperty('child_lock', state);
    return this.sendCommand('set_child_lock', state, ['child_lock']);
  }

  async setSwingModeEnabled(enabled) {
    let state = enabled ? 'on' : 'off';
    this.updateProperty('angle_enable', state);
    return this.sendCommand('set_angle_enable', state, ['angle_enable']);
  }

  async setAngle(angle) {
    angle = this.adjustOscillationAngleToRange(angle);
    this.updateProperty('angle', angle);
    return this.sendCommand('set_angle', angle, ['angle']);
  }

  async setNaturalModeEnabled(enabled) {
    let setMethod = enabled ? 'set_natural_level' : 'set_speed_level';
    let targetSpeed = this.getRotationSpeed();
    // 자연풍으로 진입하는 경우, 구형 모델(zhimi.fan.v3 등)에서는
    // 현재 속도 퍼센트를 4단계 이산값으로 변환해 줘야 명령이 먹는다.
    if (enabled && this._needsDiscreteNaturalLevels()) {
      targetSpeed = this._mapToDiscreteNaturalLevel(targetSpeed);
      // 자연풍을 켤 때 속도가 0이면 사용자가 "자연풍을 켰는데 안 도는"
      // 상황이 되므로 최소 1단계(25%)로 시작시켜 준다.
      if (targetSpeed === 0) targetSpeed = 25;
    }
    this.updateFanMode(enabled, targetSpeed); // update the fan mode instantly, do not wait for miio refresh, this improves scenes
    return this.sendCommand(setMethod, targetSpeed, ['speed_level', 'natural_level']);
  }

  async moveLeft() {
    return this.sendCommand('set_move', 'left');
  }

  async moveRight() {
    return this.sendCommand('set_move', 'right');
  }

  async setBuzzerEnabled(enabled) {
    let state = enabled ? 2 : 0;
    this.updateProperty('buzzer', state);
    return this.sendCommand('set_buzzer', state, ['buzzer']);
  }

  async setBuzzerLevel(level) {
    if (level > 2) level = 2;
    if (level < 0) level = 0;
    this.updateProperty('buzzer', level);
    return this.sendCommand('set_buzzer', level, ['buzzer']);
  }

  async setLedEnabled(enabled) {
    var level = enabled === true ? 0 : 2;
    this.updateProperty('led_b', level);
    return this.sendCommand('set_led_b', level, ['led_b']);
  }

  async setLedLevel(level) {
    if (level > 2) level = 2;
    if (level < 0) level = 0;
    this.updateProperty('led_b', level);
    return this.sendCommand('set_led_b', level, ['led_b']);
  }

  async setShutdownTimer(minutes) {
    let seconds = minutes * 60;
    this.updateProperty('poweroff_time', seconds);
    return this.sendCommand('set_poweroff_time', seconds, ['poweroff_time']);
  }

}

module.exports = MiioSmartmiFan;
