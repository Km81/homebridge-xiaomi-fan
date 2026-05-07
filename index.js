const fs = require('fs');
const FanController = require('./lib/FanController.js');
const Events = require('./lib/Events.js');

let Service, Characteristic, Homebridge, Accessory;

const PLUGIN_NAME = 'homebridge-xiaomi-fan-km81';
const PLATFORM_NAME = 'xiaomifan';
const PLUGIN_VERSION = '1.2.1';

// General constants
const BATTERY_LOW_THRESHOLD = 20;
const BUTTON_RESET_TIMEOUT = 20; // in milliseconds

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Homebridge = homebridge;
  Accessory = homebridge.platformAccessory;
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, xiaomiFanPlatform);
};

class xiaomiFanDevice {
  constructor(log, config, api, cachedAccessory, platform) {
    this.log = log;
    this.api = api;
    this.cachedAccessory = cachedAccessory; // 캐시된 액세서리 (있으면 재사용)
    this.platform = platform; // 부모 플랫폼 참조

    // check if we have mandatory device info
    try {
      if (!config.ip) throw new Error(`'ip' is required but not defined for ${config.name}!`);
      if (!config.token) throw new Error(`'token' is required but not defined for ${config.name}!`);
    } catch (error) {
      this.logError(error);
      this.logError(`Failed to create platform device, missing mandatory information!`);
      this.logError(`Please check your device config!`);
      return;
    }

    // configuration
    this.name = config['name'];
    this.ip = config['ip'];
    this.token = config['token'];
    this.deviceId = config['deviceId'];
    this.model = config['model'];
    this.pollingInterval = config['pollingInterval'] || 5;
    this.pollingInterval = this.pollingInterval * 1000;
    this.prefsDir = config['prefsDir'] || api.user.storagePath() + '/.xiaomiFan/';
    this.deepDebugLog = config.deepDebugLog;
    if (this.deepDebugLog === undefined) {
      this.deepDebugLog = false;
    }
    this.buzzerControl = config['buzzerControl'];
    if (this.buzzerControl == undefined) {
      this.buzzerControl = true;
    }
    this.ledControl = config['ledControl'];
    if (this.ledControl == undefined) {
      this.ledControl = true;
    }
    this.naturalModeControl = config['naturalModeControl'];
    if (this.naturalModeControl == undefined) {
      this.naturalModeControl = true;
    }
    this.sleepModeControl = config['sleepModeControl'];
    if (this.sleepModeControl == undefined) {
      this.sleepModeControl = true;
    }
    this.moveControl = config['moveControl'];
    if (this.moveControl == undefined) {
      this.moveControl = false;
    }
    this.fanLevelControl = config['fanLevelControl'];
    if (this.fanLevelControl == undefined) {
      this.fanLevelControl = true;
    }
    this.shutdownTimer = config['shutdownTimer'];
    if (this.shutdownTimer == undefined) {
      this.shutdownTimer = false;
    }
    this.ioniserControl = config['ioniserControl'];
    if (this.ioniserControl == undefined) {
      this.ioniserControl = false;
    }
    this.angleButtons = config['angleButtons'];
    this.verticalAngleButtons = config['verticalAngleButtons'];


    this.logInfo(`Init - got fan configuration, initializing device with name: ${this.name}`);


    // check if prefs directory ends with a /, if not then add it
    if (this.prefsDir.endsWith('/') === false) {
      this.prefsDir = this.prefsDir + '/';
    }

    // check if the fan preferences directory exists, if not then create it
    if (fs.existsSync(this.prefsDir) === false) {
      fs.mkdirSync(this.prefsDir, { recursive: true });
    }

    // create fan model info file name
    this.fanInfoFile = this.prefsDir + 'info_' + this.ip.split('.').join('') + '_' + this.token;

    // prepare variables
    this.fanDevice = undefined;
    this.cachedFanInfo = {};
    this.rotationSpeedTimeout = null; // for rotation speed set debounce

    //try to load cached fan info
    this.loadFanInfo();

    //start the fan discovery
    this.discoverFan();
  }


  /*----------========== SETUP ==========----------*/

  discoverFan() {
    // if the user specified a model then use that, else try to get cached model
    let fanController = new FanController(this.ip, this.token, this.deviceId, this.model || this.cachedFanInfo.model, this.name, this.pollingInterval, this.log);
    fanController.setDeepDebugLogEnabled(this.deepDebugLog);

    fanController.on(Events.FAN_DEVICE_READY, (fanDevice) => {
      this.fanDevice = fanDevice;

      //prepare the fan accessory and services
      if (!this.fanAccesory) {
        this.initFanAccessory();
      }
    });

    fanController.on(Events.FAN_CONNECTED, (fanDevice) => {
      // update fan information
      this.updateInformationService();
      // save fan information
      this.saveFanInfo();
    });

    fanController.on(Events.FAN_DISCONNECTED, (fanDevice) => {
      this.updateFanStatus();
    });

    fanController.on(Events.FAN_PROPERTIES_UPDATED, (fanDevice) => {
      this.updateFanStatus();
    });

    fanController.connectToFan();
  }


  /*----------========== SETUP SERVICES ==========----------*/

  initFanAccessory() {
    // generate uuid
    this.UUID = Homebridge.hap.uuid.generate(this.token + this.ip + PLATFORM_NAME);

    // 캐시된 액세서리가 있으면 재사용 (사용자가 변경한 ConfiguredName 보존됨)
    if (this.cachedAccessory) {
      this.fanAccesory = this.cachedAccessory;
      this.logDebug(`캐시된 액세서리 재사용: ${this.fanAccesory.displayName}`);
    } else {
      // 새 액세서리 생성 및 등록
      this.fanAccesory = new Accessory(this.name, this.UUID, Homebridge.hap.Categories.FAN);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.fanAccesory]);
      if (this.platform) {
        this.platform.fans.push(this.fanAccesory);
      }
      this.logDebug(`새 액세서리 등록: ${this.name}`);
    }

    // prepare accessory services
    if (this.fanDevice) {
      this.setupAccessoryServices();
    }
  }

  /**
   * Helper: 서비스를 가져오거나 새로 만든다.
   * 기존 서비스가 있으면 재사용하여 사용자가 Home 앱에서 변경한 ConfiguredName 등의 값을 보존.
   * - Name: 매번 plugin 기본 이름으로 설정 (HomeKit fallback용)
   * - ConfiguredName: 처음 한 번만 기본 이름으로 설정하고, 이후엔 사용자 변경값 유지
   */
  getOrCreateService(ServiceClass, displayName, subType) {
    let service = this.fanAccesory.getServiceById(ServiceClass, subType);
    if (!service) {
      service = new ServiceClass(displayName, subType);
      this.fanAccesory.addService(service);
    }

    // Name characteristic 명시적 설정 (ConfiguredName이 비어있을 때 fallback)
    service.setCharacteristic(Characteristic.Name, displayName);

    // ConfiguredName characteristic 추가 (없을 때만 초기값 설정 → 사용자 변경값 보존)
    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      service.addCharacteristic(Characteristic.ConfiguredName);
      service.setCharacteristic(Characteristic.ConfiguredName, displayName);
    }

    return service;
  }

  setupAccessoryServices() {
    // update the services
    this.updateInformationService();

    // prepare the fan service
    this.prepareFanService();

    // additional services
    this.prepareMoveControlService();
    this.prepareBuzzerControlService();
    this.prepareLedControlService();
    this.prepareNaturalModeControlService();
    this.prepareShutdownTimerService();
    this.prepareAngleButtonsService();
    this.prepareVerticalAngleButtonsService();
    this.prepareFanLevelControlService();
    this.prepareSleepModeControlService();
    this.prepareIoniserControlService();
    this.prepareTemperatureService();
    this.prepareRelativeHumidityService();
    this.prepareBatteryService();
  }

  updateInformationService() {
    // AccessoryInformation은 액세서리에 기본 포함되므로 가져와서 재사용
    let infoService = this.fanAccesory.getService(Service.AccessoryInformation);
    if (!infoService) {
      infoService = this.fanAccesory.addService(Service.AccessoryInformation);
    }

    let fanModel = this.fanDevice.getFanModel() || 'Unknown';
    let fanDeviceId = this.fanDevice.getDeviceId() || 'Unknown';

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
      .setCharacteristic(Characteristic.Model, fanModel)
      .setCharacteristic(Characteristic.SerialNumber, fanDeviceId)
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.informationService = infoService;
  }

  prepareFanService() {
    this.fanService = this.getOrCreateService(Service.Fanv2, this.name, 'fanService');

    // 캐시에서 복원된 액세서리에 LockPhysicalControls 등 더 이상 사용하지 않는
    // characteristic이 남아 있으면 명시적으로 제거 (Home 앱 UI 정리 목적)
    if (this.fanService.testCharacteristic(Characteristic.LockPhysicalControls)) {
      const lockChar = this.fanService.getCharacteristic(Characteristic.LockPhysicalControls);
      this.fanService.removeCharacteristic(lockChar);
      this.logDebug('레거시 LockPhysicalControls characteristic 제거됨');
    }

    // 핸들러 바인딩 (매번 다시 설정해도 .onGet/.onSet은 덮어쓰므로 안전)
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.setPowerState.bind(this));

    if (!this.fanService.testCharacteristic(Characteristic.CurrentFanState)) {
      this.fanService.addCharacteristic(Characteristic.CurrentFanState);
    }
    this.fanService.getCharacteristic(Characteristic.CurrentFanState)
      .onGet(this.getFanState.bind(this));

    if (this.fanDevice.supportsFanSpeed()) {
      if (!this.fanService.testCharacteristic(Characteristic.RotationSpeed)) {
        this.fanService.addCharacteristic(Characteristic.RotationSpeed);
      }
      this.fanService.getCharacteristic(Characteristic.RotationSpeed)
        .onGet(this.getRotationSpeed.bind(this))
        .onSet(this.setRotationSpeed.bind(this));
    }

    // 어린이 보호용 잠금장치(LockPhysicalControls)는 의도적으로 제거함
    // - HomeKit Home 앱에서 불필요하게 노출되어 UI를 복잡하게 만듬

    if (!this.fanService.testCharacteristic(Characteristic.SwingMode)) {
      this.fanService.addCharacteristic(Characteristic.SwingMode);
    }
    this.fanService.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    // RotationDirection은 자연풍/일반풍 전환 토글로 재활용
    // (Home 앱의 회전 방향 아이콘이 자연풍 모드 토글로 동작)
    if (this.fanDevice.supportsNaturalMode()) {
      if (!this.fanService.testCharacteristic(Characteristic.RotationDirection)) {
        this.fanService.addCharacteristic(Characteristic.RotationDirection);
      }
      this.fanService.getCharacteristic(Characteristic.RotationDirection)
        .onGet(this.getRotationDirection.bind(this))
        .onSet(this.setRotationDirection.bind(this));
    }
  }

  prepareMoveControlService() {
    if (this.moveControl && this.fanDevice.supportsLeftRightMove()) {
      this.moveLeftService = this.getOrCreateService(Service.Switch, 'Move left', 'moveLeftService');
      this.moveLeftService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getMoveFanSwitch.bind(this))
        .onSet((state) => {
          return this.setMoveFanSwitch(state, 'left');
        });

      this.moveRightService = this.getOrCreateService(Service.Switch, 'Move right', 'moveRightService');
      this.moveRightService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getMoveFanSwitch.bind(this))
        .onSet((state) => {
          return this.setMoveFanSwitch(state, 'right');
        });
    }

    if (this.moveControl && this.fanDevice.supportsUpDownMove()) {
      this.moveUpService = this.getOrCreateService(Service.Switch, 'Move Up', 'moveUpService');
      this.moveUpService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getMoveFanSwitch.bind(this))
        .onSet((state) => {
          return this.setMoveFanSwitch(state, 'up');
        });

      this.moveDownService = this.getOrCreateService(Service.Switch, 'Move down', 'moveDownService');
      this.moveDownService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getMoveFanSwitch.bind(this))
        .onSet((state) => {
          return this.setMoveFanSwitch(state, 'down');
        });
    }
  }

  prepareBuzzerControlService() {
    if (this.buzzerControl && this.fanDevice.supportsBuzzerControl()) {
      this.buzzerService = this.getOrCreateService(Service.Switch, 'Buzzer', 'buzzerService');
      this.buzzerService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getBuzzer.bind(this))
        .onSet(this.setBuzzer.bind(this));
    }
  }

  prepareLedControlService() {
    if (this.ledControl && this.fanDevice.supportsLedControl()) {
      if (this.fanDevice.supportsLedBrightness()) {
        // if brightness supported then add a lightbulb for controlling
        this.ledBrightnessService = this.getOrCreateService(Service.Lightbulb, 'LED', 'ledBrightnessService');
        this.ledBrightnessService
          .getCharacteristic(Characteristic.On)
          .onGet(this.getLed.bind(this))
          .onSet(this.setLed.bind(this));

        if (!this.ledBrightnessService.testCharacteristic(Characteristic.Brightness)) {
          this.ledBrightnessService.addCharacteristic(Characteristic.Brightness);
        }
        this.ledBrightnessService.getCharacteristic(Characteristic.Brightness)
          .onGet(this.getLedBrightness.bind(this))
          .onSet(this.setLedBrightness.bind(this));
      } else if (this.fanDevice.supportsLedControl()) {
        // if not then just a simple switch
        this.ledService = this.getOrCreateService(Service.Switch, 'LED', 'ledService');
        this.ledService
          .getCharacteristic(Characteristic.On)
          .onGet(this.getLed.bind(this))
          .onSet(this.setLed.bind(this));
      }
    }
  }

  prepareNaturalModeControlService() {
    if (this.naturalModeControl && this.fanDevice.supportsNaturalMode()) {
      this.naturalModeControlService = this.getOrCreateService(Service.Switch, 'Natural mode', 'naturalModeControlService');
      this.naturalModeControlService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getNaturalMode.bind(this))
        .onSet(this.setNaturalMode.bind(this));
    }
  }

  prepareSleepModeControlService() {
    if (this.sleepModeControl && this.fanDevice.supportsSleepMode()) {
      this.sleepModeControlService = this.getOrCreateService(Service.Switch, 'Sleep mode', 'sleepModeControlService');
      this.sleepModeControlService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getSleepMode.bind(this))
        .onSet(this.setSleepMode.bind(this));
    }
  }

  prepareShutdownTimerService() {
    if (this.shutdownTimer && this.fanDevice.supportsPowerOffTimer()) {
      this.shutdownTimerService = this.getOrCreateService(Service.Lightbulb, 'Shutdown timer', 'shutdownTimerService');
      this.shutdownTimerService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getShutdownTimerEnabled.bind(this))
        .onSet(this.setShutdownTimerEnabled.bind(this));

      if (!this.shutdownTimerService.testCharacteristic(Characteristic.Brightness)) {
        this.shutdownTimerService.addCharacteristic(Characteristic.Brightness);
      }
      this.shutdownTimerService.getCharacteristic(Characteristic.Brightness)
        .onGet(this.getShutdownTimer.bind(this))
        .onSet(this.setShutdownTimer.bind(this));
    }
  }

  prepareAngleButtonsService() {
    if (this.fanDevice.supportsOscillationAngle() === false && this.fanDevice.supportsOscillationLevels() === false) {
      return;
    }

    if (this.angleButtons === false) {
      return;
    }

    if (this.angleButtons === undefined || this.angleButtons === null) {
      if (this.fanDevice.supportsOscillationLevels()) {
        // if the fan supports oscillation levels, and user did not specify the property then show all oscillation levels
        this.angleButtons = this.fanDevice.oscillationLevels();
      } else {
        return;
      }
    }

    if (Array.isArray(this.angleButtons) === false) {
      this.logWarn('The angle buttons service needs to be defined as an array! Please correct your config.json if you want to use the service.');
      return;
    }

    this.angleButtonsService = new Array();
    this.angleButtons.forEach((value, i) => {
      let parsedValue = parseInt(value);

      if (this.checkAngleButtonValue(parsedValue) === false) {
        return;
      }

      this.angleButtons[i] = parsedValue;
      const angleName = 'Angle - ' + parsedValue;
      let tmpAngleButton = this.getOrCreateService(Service.Switch, angleName, 'angleButtonService' + i);
      tmpAngleButton
        .getCharacteristic(Characteristic.On)
        .onGet(() => {
          return this.getAngleButtonState(parsedValue);
        })
        .onSet((state) => {
          return this.setAngleButtonState(state, parsedValue);
        });

      this.angleButtonsService.push(tmpAngleButton);
    });
  }

  prepareVerticalAngleButtonsService() {
    if (this.fanDevice.supportsVerticalOscillationAngle() === false && this.fanDevice.supportsOscillationVerticalLevels() === false) {
      return;
    }

    if (this.verticalAngleButtons === false) {
      return;
    }

    if (this.verticalAngleButtons === undefined || this.verticalAngleButtons === null) {
      if (this.fanDevice.supportsOscillationVerticalLevels()) {
        // if the fan supports vertical oscillation levels, and user did not specify the property then show all oscillation levels
        this.verticalAngleButtons = this.fanDevice.oscillationVerticalLevels();
      } else {
        return;
      }
    }

    if (Array.isArray(this.verticalAngleButtons) === false) {
      this.logWarn('The vertical angle buttons service needs to be defined as an array! Please correct your config.json if you want to use the service.');
      return;
    }

    this.verticalAngleButtonsService = new Array();
    this.verticalAngleButtons.forEach((value, i) => {
      let parsedValue = parseInt(value);

      if (this.checkVerticalAngleButtonValue(parsedValue) === false) {
        return;
      }

      this.verticalAngleButtons[i] = parsedValue;
      const vAngleName = 'Vertical Angle - ' + parsedValue;
      let tmpAngleButton = this.getOrCreateService(Service.Switch, vAngleName, 'verticalAngleButtonService' + i);
      tmpAngleButton
        .getCharacteristic(Characteristic.On)
        .onGet(() => {
          return this.getVerticalAngleButtonState(parsedValue);
        })
        .onSet((state) => {
          return this.setVerticalAngleButtonState(state, parsedValue);
        });

      this.verticalAngleButtonsService.push(tmpAngleButton);
    });
  }

  prepareFanLevelControlService() {
    if (this.fanLevelControl && this.fanDevice.supportsFanLevel()) {
      this.fanLevelControlService = new Array();
      for (let i = 1; i <= this.fanDevice.numberOfFanLevels(); i++) {
        const levelName = 'Level ' + i;
        let tmpFanLevelButton = this.getOrCreateService(Service.Switch, levelName, 'levelControlService' + i);
        tmpFanLevelButton
          .getCharacteristic(Characteristic.On)
          .onGet(() => {
            return this.getFanLevelState(i);
          })
          .onSet((state) => {
            return this.setFanLevelState(state, i);
          });

        this.fanLevelControlService.push(tmpFanLevelButton);
      }
    }
  }

  prepareIoniserControlService() {
    if (this.ioniserControl && this.fanDevice.supportsIoniser()) {
      this.ioniserControlService = this.getOrCreateService(Service.Switch, 'Ioniser', 'ioniserControlService');
      this.ioniserControlService
        .getCharacteristic(Characteristic.On)
        .onGet(this.getIoniserState.bind(this))
        .onSet(this.setIoniserState.bind(this));
    }
  }

  prepareTemperatureService() {
    if (this.fanDevice.supportsTemperatureReporting()) {
      this.temperatureService = this.getOrCreateService(Service.TemperatureSensor, 'Temp', 'temperatureService');
      this.temperatureService
        .setCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT)
        .setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED)
        .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      this.temperatureService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));
    }
  }

  prepareRelativeHumidityService() {
    if (this.fanDevice.supportsRelativeHumidityReporting()) {
      this.relativeHumidityService = this.getOrCreateService(Service.HumiditySensor, 'Humidity', 'relativeHumidityService');
      this.relativeHumidityService
        .setCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT)
        .setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED)
        .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      this.relativeHumidityService
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .onGet(this.getCurrentRelativeHumidity.bind(this));
    }
  }

  prepareBatteryService() {
    if (this.fanDevice.hasBuiltInBattery() && this.fanDevice.supportsBatteryStateReporting()) {
      // Service.Battery is the name in HAP-nodejs 13+ (Homebridge 2.0), with BatteryService as fallback
      const BatteryServiceClass = Service.Battery || Service.BatteryService;
      this.batteryService = this.getOrCreateService(BatteryServiceClass, 'Battery', 'batteryService');
      this.batteryService
        .setCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGING)
        .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      this.batteryService
        .getCharacteristic(Characteristic.BatteryLevel)
        .onGet(this.getBatteryLevel.bind(this));
      this.batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .onGet(this.getBatteryLevelStatus.bind(this));
    }
  }


  /*----------========== HOMEBRIDGE STATE SETTERS/GETTERS ==========----------*/

  async getPowerState() {
    let isFanOn = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isFanOn = this.fanDevice.isPowerOn();
    }
    return isFanOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
  }

  async setPowerState(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      let isPowerOn = state === Characteristic.Active.ACTIVE;
      // only fire the setPowerOn method when we want to turn off the fan or the fan is off
      // the rotation speed slider fires this method many times even when the fan is already on so i need to limit that
      if (isPowerOn === false || this.fanDevice.isPowerOn() === false) {
        this.fanDevice.setPowerOn(isPowerOn);
      }
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getFanState() {
    let fanState = Characteristic.CurrentFanState.INACTIVE;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      fanState = this.fanDevice.isPowerOn() ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.IDLE;
    }
    return fanState;
  }

  async getRotationSpeed() {
    let fanRotationSpeed = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      fanRotationSpeed = this.fanDevice.getRotationSpeed();
      fanRotationSpeed = this.adjustToPercentageRange(fanRotationSpeed);
    }
    return fanRotationSpeed;
  }

  async setRotationSpeed(value) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      // use debounce to limit the number of calls when the user slides the rotation slider
      if (this.rotationSpeedTimeout) clearTimeout(this.rotationSpeedTimeout);
      this.rotationSpeedTimeout = setTimeout(() => this.fanDevice.setRotationSpeed(value), 500);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getLockPhysicalControls() {
    let isChildLockActive = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isChildLockActive = this.fanDevice.isChildLockActive();
    }
    return isChildLockActive ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
  }

  async setLockPhysicalControls(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      let isChildLockActive = state === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
      this.fanDevice.setChildLock(isChildLockActive);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getSwingMode() {
    let isSwingModeActive = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isSwingModeActive = this.fanDevice.isSwingModeEnabled();
    }
    return isSwingModeActive ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
  }

  async setSwingMode(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      let isSwingModeActive = state === Characteristic.SwingMode.SWING_ENABLED;
      this.fanDevice.setSwingModeEnabled(isSwingModeActive);
      this.updateAngleButtonsAndSwingMode(null, isSwingModeActive); // update the angle buttons if enabled
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // RotationDirection은 기본적으로 부저 음량 전환 용도였으나
  // 자연풍/일반풍(Straight wind / Natural wind) 토글로 재활용한다.
  // - CLOCKWISE      → 자연풍 모드 ON  (Natural wind)
  // - COUNTER_CLOCKWISE → 일반풍 모드 (Straight wind, Natural OFF)
  async getRotationDirection() {
    let isNaturalMode = false;
    if (this.fanDevice && this.fanDevice.isFanConnected() && this.fanDevice.supportsNaturalMode()) {
      isNaturalMode = this.fanDevice.isNaturalModeEnabled();
    }
    return isNaturalMode ? Characteristic.RotationDirection.CLOCKWISE : Characteristic.RotationDirection.COUNTER_CLOCKWISE;
  }

  async setRotationDirection(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected() && this.fanDevice.supportsNaturalMode()) {
      const enableNatural = state === Characteristic.RotationDirection.CLOCKWISE;
      this.fanDevice.setNaturalModeEnabled(enableNatural);

      // 별도의 자연풍 스위치 액세서리(naturalModeControlService)가 있다면 상태 동기화
      if (this.naturalModeControlService) {
        this.naturalModeControlService.getCharacteristic(Characteristic.On).updateValue(enableNatural);
      }
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getMoveFanSwitch() {
    return false;
  }

  async setMoveFanSwitch(state, direction) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (direction === 'left') {
        this.fanDevice.moveLeft();
      } else if (direction === 'right') {
        this.fanDevice.moveRight();
      } else if (direction === 'up') {
        this.fanDevice.moveUp();
      } else if (direction === 'down') {
        this.fanDevice.modeDown();
      }
      setTimeout(() => {
        if (this.moveLeftService) this.moveLeftService.getCharacteristic(Characteristic.On).updateValue(false);
        if (this.moveRightService) this.moveRightService.getCharacteristic(Characteristic.On).updateValue(false);
        if (this.moveUpService) this.moveUpService.getCharacteristic(Characteristic.On).updateValue(false);
        if (this.moveDownService) this.moveDownService.getCharacteristic(Characteristic.On).updateValue(false);
      }, BUTTON_RESET_TIMEOUT);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getBuzzer() {
    let isBuzzerEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isBuzzerEnabled = this.fanDevice.isBuzzerEnabled();
    }
    return isBuzzerEnabled;
  }

  async setBuzzer(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setBuzzerEnabled(state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getLed() {
    let isLedEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isLedEnabled = this.fanDevice.isLedEnabled();
    }
    return isLedEnabled;
  }

  async setLed(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (state === false || this.fanDevice.isLedEnabled() === false) {
        this.fanDevice.setLedEnabled(state);
      }
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getLedBrightness() {
    let ledBrightness = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      ledBrightness = this.fanDevice.getLedBrightness();
      ledBrightness = this.adjustToPercentageRange(ledBrightness);
    }
    return ledBrightness;
  }

  async setLedBrightness(value) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setLedBrightness(value);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getNaturalMode() {
    let naturalModeButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      naturalModeButtonEnabled = this.fanDevice.isNaturalModeEnabled();
    }
    return naturalModeButtonEnabled;
  }

  async setNaturalMode(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setNaturalModeEnabled(state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getSleepMode() {
    let sleepModeButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      sleepModeButtonEnabled = this.fanDevice.isSleepModeEnabled();
    }
    return sleepModeButtonEnabled;
  }

  async setSleepMode(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setSleepModeEnabled(state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getShutdownTimerEnabled() {
    let isShutdownTimerEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      isShutdownTimerEnabled = this.fanDevice.isShutdownTimerEnabled();
    }
    return isShutdownTimerEnabled;
  }

  async setShutdownTimerEnabled(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (state === false) { // only if disabling, enabling will automatically set it to 100%
        this.fanDevice.setShutdownTimer(0);
      }
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getShutdownTimer() {
    let shutdownTimerTime = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      shutdownTimerTime = this.fanDevice.getShutdownTimer();
      shutdownTimerTime = this.adjustToPercentageRange(shutdownTimerTime);
    }
    return shutdownTimerTime;
  }

  async setShutdownTimer(level) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setShutdownTimer(level);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getAngleButtonState(angle) {
    let angleButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (this.fanDevice.isPowerOn() && this.fanDevice.isSwingModeEnabled()) {
        angleButtonEnabled = this.fanDevice.getAngle() === angle;
      }
    }
    return angleButtonEnabled;
  }

  async setAngleButtonState(state, angle) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (state) {
        // if swing mode disabled then turn it on
        if (this.fanDevice.isSwingModeEnabled() === false) {
          this.fanDevice.setSwingModeEnabled(true);
        }
        this.fanDevice.setAngle(angle);
      } else {
        this.fanDevice.setSwingModeEnabled(false);
      }
      this.updateAngleButtonsAndSwingMode(angle, state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getVerticalAngleButtonState(angle) {
    let verticalAngleButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (this.fanDevice.isPowerOn() && this.fanDevice.isVerticalSwingModeEnabled()) {
        verticalAngleButtonEnabled = this.fanDevice.getVerticalAngle() === angle;
      }
    }
    return verticalAngleButtonEnabled;
  }

  async setVerticalAngleButtonState(state, angle) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (state) {
        // if vertical swing mode disabled then turn it on
        if (this.fanDevice.isVerticalSwingModeEnabled() === false) {
          this.fanDevice.setVerticalSwingModeEnabled(true);
        }
        this.fanDevice.setVerticalAngle(angle);
      } else {
        this.fanDevice.setVerticalSwingModeEnabled(false);
      }
      this.updateVerticalAngleButtonsAndSwingMode(angle, state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getFanLevelState(level) {
    let levelButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected() && this.fanDevice.isPowerOn()) {
      levelButtonEnabled = this.fanDevice.getFanLevel() === level;
    }
    return levelButtonEnabled;
  }

  async setFanLevelState(state, level) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (state) {
        // if fan turned off then turn it on
        if (this.fanDevice.isPowerOn() === false) {
          this.fanDevice.setPowerOn(true);
        }
        this.fanDevice.setFanLevel(level);
      }
      setTimeout(() => {
        this.updateFanLevelButtons();
      }, BUTTON_RESET_TIMEOUT);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getIoniserState() {
    let ioniserButtonEnabled = false;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      ioniserButtonEnabled = this.fanDevice.isIoniserEnabled();
    }
    return ioniserButtonEnabled;
  }

  async setIoniserState(state) {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      this.fanDevice.setIoniserEnabled(state);
    } else {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getCurrentTemperature() {
    let temp = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      temp = this.fanDevice.getTemperature();
    }
    return temp;
  }

  async getCurrentRelativeHumidity() {
    let relHumidity = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      relHumidity = this.fanDevice.getRelativeHumidity();
    }
    return relHumidity;
  }

  async getBatteryLevel() {
    let batteryLevel = 0;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      batteryLevel = this.fanDevice.getBatteryLevel();
    }
    return batteryLevel;
  }

  async getBatteryLevelStatus() {
    let batteryLevelStatus = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      batteryLevelStatus = this.fanDevice.getBatteryLevel() <= BATTERY_LOW_THRESHOLD ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    return batteryLevelStatus;
  }


  /*----------========== HELPERS ==========----------*/

  updateFanStatus() {
    if (this.fanDevice && this.fanDevice.isFanConnected()) {
      if (this.fanService) this.fanService.getCharacteristic(Characteristic.Active).updateValue(this.fanDevice.isPowerOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
      if (this.fanService && this.fanDevice.supportsFanSpeed()) this.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(this.adjustToPercentageRange(this.fanDevice.getRotationSpeed()));
      // LockPhysicalControls 동기화 제거 (fanService에서 해당 characteristic을 더 이상 추가하지 않음)
      // RotationDirection을 자연풍 모드 상태로 동기화 (CLOCKWISE = Natural ON)
      if (this.fanService && this.fanDevice.supportsNaturalMode()) this.fanService.getCharacteristic(Characteristic.RotationDirection).updateValue(this.fanDevice.isNaturalModeEnabled() ? Characteristic.RotationDirection.CLOCKWISE : Characteristic.RotationDirection.COUNTER_CLOCKWISE);
      if (this.buzzerService) this.buzzerService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isBuzzerEnabled());
      if (this.ledService) this.ledService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isLedEnabled());
      if (this.ledBrightnessService) this.ledBrightnessService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isLedEnabled());
      if (this.ledBrightnessService) this.ledBrightnessService.getCharacteristic(Characteristic.Brightness).updateValue(this.adjustToPercentageRange(this.fanDevice.getLedBrightness()));
      if (this.naturalModeControlService) this.naturalModeControlService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isNaturalModeEnabled());
      if (this.sleepModeControlService) this.sleepModeControlService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isSleepModeEnabled());
      if (this.shutdownTimerService) this.shutdownTimerService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isShutdownTimerEnabled());
      if (this.shutdownTimerService) this.shutdownTimerService.getCharacteristic(Characteristic.Brightness).updateValue(this.adjustToPercentageRange(this.fanDevice.getShutdownTimer()));
      if (this.ioniserControlService) this.ioniserControlService.getCharacteristic(Characteristic.On).updateValue(this.fanDevice.isIoniserEnabled());
      if (this.temperatureService) this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.fanDevice.getTemperature());
      if (this.relativeHumidityService) this.relativeHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(this.fanDevice.getRelativeHumidity());
      if (this.batteryService) this.batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.fanDevice.getBatteryLevel());
      if (this.batteryService) this.batteryService.getCharacteristic(Characteristic.StatusLowBattery).updateValue(this.fanDevice.getBatteryLevel() <= BATTERY_LOW_THRESHOLD ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      this.updateAngleButtonsAndSwingMode(null, this.fanDevice.isSwingModeEnabled());
      this.updateVerticalAngleButtonsAndSwingMode(null, this.fanDevice.isVerticalSwingModeEnabled());
      this.updateFanLevelButtons();
    }
  }

  updateAngleButtonsAndSwingMode(activeAngle, enabled) {
    if (this.fanService) this.fanService.getCharacteristic(Characteristic.SwingMode).updateValue(enabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
    if (this.angleButtonsService) {
      // if swing mode disabled or the fan is not turned on then just disable all the angle switches
      if (enabled === false || this.fanDevice.isPowerOn() === false) {
        activeAngle = "disabled"; // use fake value for angle
      }

      // if angle not specified then automatically update the status
      if (activeAngle === undefined || activeAngle === null) {
        activeAngle = this.fanDevice.getAngle();
      }

      this.angleButtonsService.forEach((tmpAngleButton, i) => {
        if (activeAngle === this.angleButtons[i]) {
          tmpAngleButton.getCharacteristic(Characteristic.On).updateValue(true);
        } else {
          tmpAngleButton.getCharacteristic(Characteristic.On).updateValue(false);
        }
      });
    }
  }

  updateVerticalAngleButtonsAndSwingMode(activeAngle, enabled) {
    if (this.verticalAngleButtonsService) {
      // if vertical swing mode disabled or the fan is not turned on then just disable all the angle switches
      if (enabled === false || this.fanDevice.isPowerOn() === false) {
        activeAngle = "disabled"; // use fake value for angle
      }

      // if vertical angle not specified then automatically update the status
      if (activeAngle === undefined || activeAngle === null) {
        activeAngle = this.fanDevice.getVerticalAngle();
      }

      this.verticalAngleButtonsService.forEach((tmpAngleButton, i) => {
        if (activeAngle === this.verticalAngleButtons[i]) {
          tmpAngleButton.getCharacteristic(Characteristic.On).updateValue(true);
        } else {
          tmpAngleButton.getCharacteristic(Characteristic.On).updateValue(false);
        }
      });
    }
  }

  updateFanLevelButtons() {
    if (this.fanLevelControlService) {
      let currentLevel = this.fanDevice.getFanLevel();
      this.fanLevelControlService.forEach((tmpFanLevelButton, i) => {
        if (currentLevel === i + 1 && this.fanDevice.isPowerOn()) { // levels start from 1, index from 0 hence add 1
          tmpFanLevelButton.getCharacteristic(Characteristic.On).updateValue(true);
        } else {
          tmpFanLevelButton.getCharacteristic(Characteristic.On).updateValue(false);
        }
      });
    }
  }

  saveFanInfo() {
    // save model name and deviceId
    if (this.fanDevice) {
      this.cachedFanInfo.model = this.fanDevice.getFanModel();
      this.cachedFanInfo.deviceId = this.fanDevice.getDeviceId();
      fs.writeFile(this.fanInfoFile, JSON.stringify(this.cachedFanInfo), (err) => {
        if (err) {
          this.logDebug('Error occured could not write fan model info %s', err);
        } else {
          this.logDebug('Successfully saved fan info!');
        }
      });
    }
  }

  loadFanInfo() {
    try {
      this.cachedFanInfo = JSON.parse(fs.readFileSync(this.fanInfoFile));
    } catch (err) {
      this.logDebug('Fan info file does not exist yet, device unknown!');
    }
  }

  checkAngleButtonValue(angleValue) {
    if (this.fanDevice.supportsOscillationAngle()) {
      // if specified angle not within range then show a warning and stop processing this value
      if (this.fanDevice.checkOscillationAngleWithinRange(angleValue) === false) {
        this.logWarn(`Specified angle ${angleValue} is not within the supported range ${JSON.stringify(this.fanDevice.oscillationAngleRange())}. Not adding angle button!`);
        return false;
      }
    } else if (this.fanDevice.supportsOscillationLevels()) {
      // if the fan uses predefined oscillation levels then check if the specified angle is on the list
      if (this.fanDevice.checkOscillationLevelSupported(angleValue) === false) {
        this.logWarn(`Specified angle ${angleValue} is not within the supported angle levels of your fan. Allowed values: ${JSON.stringify(this.fanDevice.oscillationLevels())}. Not adding angle button!`);
        return false;
      }
    }

    return true;
  }

  checkVerticalAngleButtonValue(angleValue) {
    if (this.fanDevice.supportsVerticalOscillationAngle()) {
      // if specified angle not within range then show a warning and stop processing this value
      if (this.fanDevice.checkVerticalOscillationAngleWithinRange(angleValue) === false) {
        this.logWarn(`Specified vertical angle ${angleValue} is not within the supported vertical range ${JSON.stringify(this.fanDevice.oscillationVerticalAngleRange())}. Not adding vertical angle button!`);
        return false;
      }
    } else if (this.fanDevice.supportsOscillationVerticalLevels()) {
      // if the fan uses predefined vertical oscillation levels then check if the specified angle is on the list
      if (this.fanDevice.checkVerticalOscillationLevelSupported(angleValue) === false) {
        this.logWarn(`Specified vertical angle ${angleValue} is not within the supported vertical angle levels of your fan. Allowed values: ${JSON.stringify(this.fanDevice.verticalOscillationLevels())}. Not adding vertical angle button!`);
        return false;
      }
    }

    return true;
  }

  adjustToPercentageRange(value) {
    // make sure a percentage value is a number and within 0-100
    let newValue = value;
    if (!Number.isFinite(newValue)) newValue = 0;
    if (newValue > 100) newValue = 100;
    if (newValue < 0) newValue = 0;
    return newValue;
  }

  /*----------========== LOG ==========----------*/

  logInfo(message, ...args) {
    this.log.info((this.name ? `[${this.name}] ` : "") + message, ...args);
  }

  logWarn(message, ...args) {
    this.log.warn((this.name ? `[${this.name}] ` : "") + message, ...args);
  }

  logDebug(message, ...args) {
    this.log.debug((this.name ? `[${this.name}] ` : "") + message, ...args);
  }

  logError(message, ...args) {
    this.log.error((this.name ? `[${this.name}] ` : "") + message, ...args);
  }

}


/*----------========== PLATFORM STUFF ==========----------*/
class xiaomiFanPlatform {
  constructor(log, config, api) {

    this.fans = []; // 캐시된 액세서리 목록 (configureAccessory에서 채워짐)
    this.log = log;
    this.api = api;
    this.config = config;

    if (this.api) {
      /*
       * 모든 캐시 액세서리가 configureAccessory를 통해 복원된 후 didFinishLaunching이 발생함.
       * Dynamic Platform 플러그인은 이 이벤트 이후에 신규 액세서리를 등록해야 함.
       */
      this.api.on("didFinishLaunching", () => {
        this.initDevices();
      });
    }

  }

  /*
   * 부팅 시 캐시된 액세서리가 있을 때 호출됨. 여기서는 단순히 목록에 보관해두고
   * initDevices()에서 매칭되는 device 설정과 연결한다.
   */
  configureAccessory(accessory) {
    this.log.debug("캐시된 액세서리 발견: %s", accessory.displayName);
    this.fans.push(accessory);
  }

  // ------------ CUSTOM METHODS ------------

  initDevices() {
    this.log.info('Init - 디바이스 초기화 시작');

    // config의 devices와 fans를 합쳐서 처리 (둘 다 지원)
    const allDeviceConfigs = [];
    if (this.config.devices && Array.isArray(this.config.devices)) {
      allDeviceConfigs.push(...this.config.devices);
    } else if (this.config.devices) {
      this.log.info('devices 항목이 배열이 아닙니다. Type: %s', typeof this.config.devices);
    }
    if (this.config.fans && Array.isArray(this.config.fans)) {
      allDeviceConfigs.push(...this.config.fans);
    } else if (this.config.fans) {
      this.log.info('fans 항목이 배열이 아닙니다. Type: %s', typeof this.config.fans);
    }

    if (allDeviceConfigs.length === 0) {
      this.log.info('-------------------------------------------');
      this.log.info('Init - 선풍기 설정을 찾지 못했습니다');
      this.log.info('platform 설정에 devices 또는 fans 항목을 추가하세요');
      this.log.info('-------------------------------------------');
      return;
    }

    // 사용된 캐시 액세서리를 추적 (이후 미사용 액세서리는 정리)
    const usedAccessories = new Set();

    for (let deviceConfig of allDeviceConfigs) {
      if (!deviceConfig) continue;
      if (!deviceConfig.ip || !deviceConfig.token) continue;

      // device의 UUID 생성 (xiaomiFanDevice가 사용하는 것과 동일한 방식)
      const uuid = this.api.hap.uuid.generate(deviceConfig.token + deviceConfig.ip + PLATFORM_NAME);

      // 캐시 액세서리 검색
      const cachedAccessory = this.fans.find(a => a.UUID === uuid);
      if (cachedAccessory) {
        usedAccessories.add(cachedAccessory);
      }

      new xiaomiFanDevice(this.log, deviceConfig, this.api, cachedAccessory, this);
    }

    // 설정에서 제거된 디바이스의 캐시 액세서리는 정리
    const orphanAccessories = this.fans.filter(a => !usedAccessories.has(a));
    if (orphanAccessories.length > 0) {
      this.log.info(`설정에 없는 캐시 액세서리 ${orphanAccessories.length}개 정리`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphanAccessories);
      this.fans = this.fans.filter(a => usedAccessories.has(a));
    }
  }

  removeAccessories() {
    // 모든 캐시 액세서리 제거 (현재는 사용하지 않지만 외부에서 호출 가능성을 위해 유지)
    this.log.debug("모든 캐시 액세서리 제거");
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.fans);
    this.fans = [];
  }

  removeAccessory(accessory) {
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.fans = this.fans.filter(item => item !== accessory);
  }


}
