(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Owt = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
// This file is borrowed from lynckia/licode with some modifications.

/* global unescape*/
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Base64 = void 0;

var Base64 = function () {
  var END_OF_INPUT = -1;
  var base64Str;
  var base64Count;
  var i;
  var base64Chars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/'];
  var reverseBase64Chars = [];

  for (i = 0; i < base64Chars.length; i = i + 1) {
    reverseBase64Chars[base64Chars[i]] = i;
  }

  var setBase64Str = function setBase64Str(str) {
    base64Str = str;
    base64Count = 0;
  };

  var readBase64 = function readBase64() {
    if (!base64Str) {
      return END_OF_INPUT;
    }

    if (base64Count >= base64Str.length) {
      return END_OF_INPUT;
    }

    var c = base64Str.charCodeAt(base64Count) & 0xff;
    base64Count = base64Count + 1;
    return c;
  };

  var encodeBase64 = function encodeBase64(str) {
    var result;
    var done;
    setBase64Str(str);
    result = '';
    var inBuffer = new Array(3);
    done = false;

    while (!done && (inBuffer[0] = readBase64()) !== END_OF_INPUT) {
      inBuffer[1] = readBase64();
      inBuffer[2] = readBase64();
      result = result + base64Chars[inBuffer[0] >> 2];

      if (inBuffer[1] !== END_OF_INPUT) {
        result = result + base64Chars[inBuffer[0] << 4 & 0x30 | inBuffer[1] >> 4];

        if (inBuffer[2] !== END_OF_INPUT) {
          result = result + base64Chars[inBuffer[1] << 2 & 0x3c | inBuffer[2] >> 6];
          result = result + base64Chars[inBuffer[2] & 0x3F];
        } else {
          result = result + base64Chars[inBuffer[1] << 2 & 0x3c];
          result = result + '=';
          done = true;
        }
      } else {
        result = result + base64Chars[inBuffer[0] << 4 & 0x30];
        result = result + '=';
        result = result + '=';
        done = true;
      }
    }

    return result;
  };

  var readReverseBase64 = function readReverseBase64() {
    if (!base64Str) {
      return END_OF_INPUT;
    }

    while (true) {
      // eslint-disable-line no-constant-condition
      if (base64Count >= base64Str.length) {
        return END_OF_INPUT;
      }

      var nextCharacter = base64Str.charAt(base64Count);
      base64Count = base64Count + 1;

      if (reverseBase64Chars[nextCharacter]) {
        return reverseBase64Chars[nextCharacter];
      }

      if (nextCharacter === 'A') {
        return 0;
      }
    }
  };

  var ntos = function ntos(n) {
    n = n.toString(16);

    if (n.length === 1) {
      n = '0' + n;
    }

    n = '%' + n;
    return unescape(n);
  };

  var decodeBase64 = function decodeBase64(str) {
    var result;
    var done;
    setBase64Str(str);
    result = '';
    var inBuffer = new Array(4);
    done = false;

    while (!done && (inBuffer[0] = readReverseBase64()) !== END_OF_INPUT && (inBuffer[1] = readReverseBase64()) !== END_OF_INPUT) {
      inBuffer[2] = readReverseBase64();
      inBuffer[3] = readReverseBase64();
      result = result + ntos(inBuffer[0] << 2 & 0xff | inBuffer[1] >> 4);

      if (inBuffer[2] !== END_OF_INPUT) {
        result += ntos(inBuffer[1] << 4 & 0xff | inBuffer[2] >> 2);

        if (inBuffer[3] !== END_OF_INPUT) {
          result = result + ntos(inBuffer[2] << 6 & 0xff | inBuffer[3]);
        } else {
          done = true;
        }
      } else {
        done = true;
      }
    }

    return result;
  };

  return {
    encodeBase64: encodeBase64,
    decodeBase64: decodeBase64
  };
}();

exports.Base64 = Base64;

},{}],2:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';
/**
 * @class AudioCodec
 * @memberOf Owt.Base
 * @classDesc Audio codec enumeration.
 * @hideconstructor
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VideoEncodingParameters = exports.VideoCodecParameters = exports.VideoCodec = exports.AudioEncodingParameters = exports.AudioCodecParameters = exports.AudioCodec = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var AudioCodec = {
  PCMU: 'pcmu',
  PCMA: 'pcma',
  OPUS: 'opus',
  G722: 'g722',
  ISAC: 'iSAC',
  ILBC: 'iLBC',
  AAC: 'aac',
  AC3: 'ac3',
  NELLYMOSER: 'nellymoser'
};
/**
 * @class AudioCodecParameters
 * @memberOf Owt.Base
 * @classDesc Codec parameters for an audio track.
 * @hideconstructor
 */

exports.AudioCodec = AudioCodec;

var AudioCodecParameters = // eslint-disable-next-line require-jsdoc
function AudioCodecParameters(name, channelCount, clockRate) {
  _classCallCheck(this, AudioCodecParameters);

  /**
   * @member {string} name
   * @memberof Owt.Base.AudioCodecParameters
   * @instance
   * @desc Name of a codec. Please use a value in Owt.Base.AudioCodec. However, some functions do not support all the values in Owt.Base.AudioCodec.
   */
  this.name = name;
  /**
   * @member {?number} channelCount
   * @memberof Owt.Base.AudioCodecParameters
   * @instance
   * @desc Numbers of channels for an audio track.
   */

  this.channelCount = channelCount;
  /**
   * @member {?number} clockRate
   * @memberof Owt.Base.AudioCodecParameters
   * @instance
   * @desc The codec clock rate expressed in Hertz.
   */

  this.clockRate = clockRate;
};
/**
 * @class AudioEncodingParameters
 * @memberOf Owt.Base
 * @classDesc Encoding parameters for sending an audio track.
 * @hideconstructor
 */


exports.AudioCodecParameters = AudioCodecParameters;

var AudioEncodingParameters = // eslint-disable-next-line require-jsdoc
function AudioEncodingParameters(codec, maxBitrate) {
  _classCallCheck(this, AudioEncodingParameters);

  /**
   * @member {?Owt.Base.AudioCodecParameters} codec
   * @instance
   * @memberof Owt.Base.AudioEncodingParameters
   */
  this.codec = codec;
  /**
   * @member {?number} maxBitrate
   * @instance
   * @memberof Owt.Base.AudioEncodingParameters
   * @desc Max bitrate expressed in kbps.
   */

  this.maxBitrate = maxBitrate;
};
/**
 * @class VideoCodec
 * @memberOf Owt.Base
 * @classDesc Video codec enumeration.
 * @hideconstructor
 */


exports.AudioEncodingParameters = AudioEncodingParameters;
var VideoCodec = {
  VP8: 'vp8',
  VP9: 'vp9',
  H264: 'h264',
  H265: 'h265'
};
/**
 * @class VideoCodecParameters
 * @memberOf Owt.Base
 * @classDesc Codec parameters for a video track.
 * @hideconstructor
 */

exports.VideoCodec = VideoCodec;

var VideoCodecParameters = // eslint-disable-next-line require-jsdoc
function VideoCodecParameters(name, profile) {
  _classCallCheck(this, VideoCodecParameters);

  /**
   * @member {string} name
   * @memberof Owt.Base.VideoCodecParameters
   * @instance
   * @desc Name of a codec. Please use a value in Owt.Base.VideoCodec. However, some functions do not support all the values in Owt.Base.AudioCodec.
   */
  this.name = name;
  /**
   * @member {?string} profile
   * @memberof Owt.Base.VideoCodecParameters
   * @instance
   * @desc The profile of a codec. Profile may not apply to all codecs.
   */

  this.profile = profile;
};
/**
 * @class VideoEncodingParameters
 * @memberOf Owt.Base
 * @classDesc Encoding parameters for sending a video track.
 * @hideconstructor
 */


exports.VideoCodecParameters = VideoCodecParameters;

var VideoEncodingParameters = // eslint-disable-next-line require-jsdoc
function VideoEncodingParameters(codec, maxBitrate) {
  _classCallCheck(this, VideoEncodingParameters);

  /**
   * @member {?Owt.Base.VideoCodecParameters} codec
   * @instance
   * @memberof Owt.Base.VideoEncodingParameters
   */
  this.codec = codec;
  /**
   * @member {?number} maxBitrate
   * @instance
   * @memberof Owt.Base.VideoEncodingParameters
   * @desc Max bitrate expressed in kbps.
   */

  this.maxBitrate = maxBitrate;
};

exports.VideoEncodingParameters = VideoEncodingParameters;

},{}],3:[function(require,module,exports){
// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
// This file is borrowed from lynckia/licode with some modifications.
'use strict';
/**
 * @class EventDispatcher
 * @classDesc A shim for EventTarget. Might be changed to EventTarget later.
 * @memberof Owt.Base
 * @hideconstructor
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MuteEvent = exports.ErrorEvent = exports.MessageEvent = exports.OwtEvent = exports.EventDispatcher = void 0;

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var EventDispatcher = function EventDispatcher() {
  // Private vars
  var spec = {};
  spec.dispatcher = {};
  spec.dispatcher.eventListeners = {};
  /**
   * @function addEventListener
   * @desc This function registers a callback function as a handler for the corresponding event. It's shortened form is on(eventType, listener). See the event description in the following table.
   * @instance
   * @memberof Owt.Base.EventDispatcher
   * @param {string} eventType Event string.
   * @param {function} listener Callback function.
   */

  this.addEventListener = function (eventType, listener) {
    if (spec.dispatcher.eventListeners[eventType] === undefined) {
      spec.dispatcher.eventListeners[eventType] = [];
    }

    spec.dispatcher.eventListeners[eventType].push(listener);
  };
  /**
   * @function removeEventListener
   * @desc This function removes a registered event listener.
   * @instance
   * @memberof Owt.Base.EventDispatcher
   * @param {string} eventType Event string.
   * @param {function} listener Callback function.
   */


  this.removeEventListener = function (eventType, listener) {
    if (!spec.dispatcher.eventListeners[eventType]) {
      return;
    }

    var index = spec.dispatcher.eventListeners[eventType].indexOf(listener);

    if (index !== -1) {
      spec.dispatcher.eventListeners[eventType].splice(index, 1);
    }
  };
  /**
   * @function clearEventListener
   * @desc This function removes all event listeners for one type.
   * @instance
   * @memberof Owt.Base.EventDispatcher
   * @param {string} eventType Event string.
   */


  this.clearEventListener = function (eventType) {
    spec.dispatcher.eventListeners[eventType] = [];
  }; // It dispatch a new event to the event listeners, based on the type
  // of event. All events are intended to be LicodeEvents.


  this.dispatchEvent = function (event) {
    if (!spec.dispatcher.eventListeners[event.type]) {
      return;
    }

    spec.dispatcher.eventListeners[event.type].map(function (listener) {
      listener(event);
    });
  };
};
/**
 * @class OwtEvent
 * @classDesc Class OwtEvent represents a generic Event in the library.
 * @memberof Owt.Base
 * @hideconstructor
 */


exports.EventDispatcher = EventDispatcher;

var OwtEvent = // eslint-disable-next-line require-jsdoc
function OwtEvent(type) {
  _classCallCheck(this, OwtEvent);

  this.type = type;
};
/**
 * @class MessageEvent
 * @classDesc Class MessageEvent represents a message Event in the library.
 * @memberof Owt.Base
 * @hideconstructor
 */


exports.OwtEvent = OwtEvent;

var MessageEvent =
/*#__PURE__*/
function (_OwtEvent) {
  _inherits(MessageEvent, _OwtEvent);

  // eslint-disable-next-line require-jsdoc
  function MessageEvent(type, init) {
    var _this;

    _classCallCheck(this, MessageEvent);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(MessageEvent).call(this, type));
    /**
     * @member {string} origin
     * @instance
     * @memberof Owt.Base.MessageEvent
     * @desc ID of the remote endpoint who published this stream.
     */

    _this.origin = init.origin;
    /**
     * @member {string} message
     * @instance
     * @memberof Owt.Base.MessageEvent
     */

    _this.message = init.message;
    /**
     * @member {string} to
     * @instance
     * @memberof Owt.Base.MessageEvent
     * @desc Values could be "all", "me" in conference mode, or undefined in P2P mode..
     */

    _this.to = init.to;
    return _this;
  }

  return MessageEvent;
}(OwtEvent);
/**
 * @class ErrorEvent
 * @classDesc Class ErrorEvent represents an error Event in the library.
 * @memberof Owt.Base
 * @hideconstructor
 */


exports.MessageEvent = MessageEvent;

var ErrorEvent =
/*#__PURE__*/
function (_OwtEvent2) {
  _inherits(ErrorEvent, _OwtEvent2);

  // eslint-disable-next-line require-jsdoc
  function ErrorEvent(type, init) {
    var _this2;

    _classCallCheck(this, ErrorEvent);

    _this2 = _possibleConstructorReturn(this, _getPrototypeOf(ErrorEvent).call(this, type));
    /**
     * @member {Error} error
     * @instance
     * @memberof Owt.Base.ErrorEvent
     */

    _this2.error = init.error;
    return _this2;
  }

  return ErrorEvent;
}(OwtEvent);
/**
 * @class MuteEvent
 * @classDesc Class MuteEvent represents a mute or unmute event.
 * @memberof Owt.Base
 * @hideconstructor
 */


exports.ErrorEvent = ErrorEvent;

var MuteEvent =
/*#__PURE__*/
function (_OwtEvent3) {
  _inherits(MuteEvent, _OwtEvent3);

  // eslint-disable-next-line require-jsdoc
  function MuteEvent(type, init) {
    var _this3;

    _classCallCheck(this, MuteEvent);

    _this3 = _possibleConstructorReturn(this, _getPrototypeOf(MuteEvent).call(this, type));
    /**
     * @member {Owt.Base.TrackKind} kind
     * @instance
     * @memberof Owt.Base.MuteEvent
     */

    _this3.kind = init.kind;
    return _this3;
  }

  return MuteEvent;
}(OwtEvent);

exports.MuteEvent = MuteEvent;

},{}],4:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _mediastreamFactory = require("./mediastream-factory.js");

Object.keys(_mediastreamFactory).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _mediastreamFactory[key];
    }
  });
});

var _stream = require("./stream.js");

Object.keys(_stream).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _stream[key];
    }
  });
});

var _mediaformat = require("./mediaformat.js");

Object.keys(_mediaformat).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function get() {
      return _mediaformat[key];
    }
  });
});

},{"./mediaformat.js":6,"./mediastream-factory.js":7,"./stream.js":10}],5:[function(require,module,exports){
// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
// This file is borrowed from lynckia/licode with some modifications.

/* global console,window */
'use strict';
/*
 * API to write logs based on traditional logging mechanisms: debug, trace,
 * info, warning, error
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var Logger = function () {
  var DEBUG = 0;
  var TRACE = 1;
  var INFO = 2;
  var WARNING = 3;
  var ERROR = 4;
  var NONE = 5;

  var noOp = function noOp() {}; // |that| is the object to be returned.


  var that = {
    DEBUG: DEBUG,
    TRACE: TRACE,
    INFO: INFO,
    WARNING: WARNING,
    ERROR: ERROR,
    NONE: NONE
  };
  that.log = window.console.log.bind(window.console);

  var bindType = function bindType(type) {
    if (typeof window.console[type] === 'function') {
      return window.console[type].bind(window.console);
    } else {
      return window.console.log.bind(window.console);
    }
  };

  var setLogLevel = function setLogLevel(level) {
    if (level <= DEBUG) {
      that.debug = bindType('log');
    } else {
      that.debug = noOp;
    }

    if (level <= TRACE) {
      that.trace = bindType('trace');
    } else {
      that.trace = noOp;
    }

    if (level <= INFO) {
      that.info = bindType('info');
    } else {
      that.info = noOp;
    }

    if (level <= WARNING) {
      that.warning = bindType('warn');
    } else {
      that.warning = noOp;
    }

    if (level <= ERROR) {
      that.error = bindType('error');
    } else {
      that.error = noOp;
    }
  };

  setLogLevel(DEBUG); // Default level is debug.

  that.setLogLevel = setLogLevel;
  return that;
}();

var _default = Logger;
exports.default = _default;

},{}],6:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';
/**
 * @class AudioSourceInfo
 * @classDesc Source info about an audio track. Values: 'mic', 'screen-cast', 'file', 'mixed'.
 * @memberOf Owt.Base
 * @readonly
 * @enum {string}
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Resolution = exports.TrackKind = exports.VideoSourceInfo = exports.AudioSourceInfo = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var AudioSourceInfo = {
  MIC: 'mic',
  SCREENCAST: 'screen-cast',
  FILE: 'file',
  MIXED: 'mixed'
};
/**
 * @class VideoSourceInfo
 * @classDesc Source info about a video track. Values: 'camera', 'screen-cast', 'file', 'mixed'.
 * @memberOf Owt.Base
 * @readonly
 * @enum {string}
 */

exports.AudioSourceInfo = AudioSourceInfo;
var VideoSourceInfo = {
  CAMERA: 'camera',
  SCREENCAST: 'screen-cast',
  FILE: 'file',
  MIXED: 'mixed'
};
/**
 * @class TrackKind
 * @classDesc Kind of a track. Values: 'audio' for audio track, 'video' for video track, 'av' for both audio and video tracks.
 * @memberOf Owt.Base
 * @readonly
 * @enum {string}
 */

exports.VideoSourceInfo = VideoSourceInfo;
var TrackKind = {
  /**
   * Audio tracks.
   * @type string
   */
  AUDIO: 'audio',

  /**
   * Video tracks.
   * @type string
   */
  VIDEO: 'video',

  /**
   * Both audio and video tracks.
   * @type string
   */
  AUDIO_AND_VIDEO: 'av'
};
/**
 * @class Resolution
 * @memberOf Owt.Base
 * @classDesc The Resolution defines the size of a rectangle.
 * @constructor
 * @param {number} width
 * @param {number} height
 */

exports.TrackKind = TrackKind;

var Resolution = // eslint-disable-next-line require-jsdoc
function Resolution(width, height) {
  _classCallCheck(this, Resolution);

  /**
   * @member {number} width
   * @instance
   * @memberof Owt.Base.Resolution
   */
  this.width = width;
  /**
   * @member {number} height
   * @instance
   * @memberof Owt.Base.Resolution
   */

  this.height = height;
};

exports.Resolution = Resolution;

},{}],7:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* global console, window, Promise, chrome, navigator */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MediaStreamFactory = exports.StreamConstraints = exports.VideoTrackConstraints = exports.AudioTrackConstraints = void 0;

var utils = _interopRequireWildcard(require("./utils.js"));

var _logger = _interopRequireDefault(require("./logger.js"));

var MediaFormatModule = _interopRequireWildcard(require("./mediaformat.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * @class AudioTrackConstraints
 * @classDesc Constraints for creating an audio MediaStreamTrack.
 * @memberof Owt.Base
 * @constructor
 * @param {Owt.Base.AudioSourceInfo} source Source info of this audio track.
 */
var AudioTrackConstraints = // eslint-disable-next-line require-jsdoc
function AudioTrackConstraints(source) {
  _classCallCheck(this, AudioTrackConstraints);

  if (!Object.values(MediaFormatModule.AudioSourceInfo).some(function (v) {
    return v === source;
  })) {
    throw new TypeError('Invalid source.');
  }
  /**
   * @member {string} source
   * @memberof Owt.Base.AudioTrackConstraints
   * @desc Values could be "mic", "screen-cast", "file" or "mixed".
   * @instance
   */


  this.source = source;
  /**
   * @member {string} deviceId
   * @memberof Owt.Base.AudioTrackConstraints
   * @desc Do not provide deviceId if source is not "mic".
   * @instance
   * @see https://w3c.github.io/mediacapture-main/#def-constraint-deviceId
   */

  this.deviceId = undefined;
};
/**
 * @class VideoTrackConstraints
 * @classDesc Constraints for creating a video MediaStreamTrack.
 * @memberof Owt.Base
 * @constructor
 * @param {Owt.Base.VideoSourceInfo} source Source info of this video track.
 */


exports.AudioTrackConstraints = AudioTrackConstraints;

var VideoTrackConstraints = // eslint-disable-next-line require-jsdoc
function VideoTrackConstraints(source) {
  _classCallCheck(this, VideoTrackConstraints);

  if (!Object.values(MediaFormatModule.VideoSourceInfo).some(function (v) {
    return v === source;
  })) {
    throw new TypeError('Invalid source.');
  }
  /**
   * @member {string} source
   * @memberof Owt.Base.VideoTrackConstraints
   * @desc Values could be "camera", "screen-cast", "file" or "mixed".
   * @instance
   */


  this.source = source;
  /**
   * @member {string} deviceId
   * @memberof Owt.Base.VideoTrackConstraints
   * @desc Do not provide deviceId if source is not "camera".
   * @instance
   * @see https://w3c.github.io/mediacapture-main/#def-constraint-deviceId
   */

  this.deviceId = undefined;
  /**
   * @member {Owt.Base.Resolution} resolution
   * @memberof Owt.Base.VideoTrackConstraints
   * @instance
   */

  this.resolution = undefined;
  /**
   * @member {number} frameRate
   * @memberof Owt.Base.VideoTrackConstraints
   * @instance
   */

  this.frameRate = undefined;
};
/**
 * @class StreamConstraints
 * @classDesc Constraints for creating a MediaStream from screen mic and camera.
 * @memberof Owt.Base
 * @constructor
 * @param {?Owt.Base.AudioTrackConstraints} audioConstraints
 * @param {?Owt.Base.VideoTrackConstraints} videoConstraints
 */


exports.VideoTrackConstraints = VideoTrackConstraints;

var StreamConstraints = // eslint-disable-next-line require-jsdoc
function StreamConstraints() {
  var audioConstraints = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
  var videoConstraints = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

  _classCallCheck(this, StreamConstraints);

  /**
   * @member {Owt.Base.MediaStreamTrackDeviceConstraintsForAudio} audio
   * @memberof Owt.Base.MediaStreamDeviceConstraints
   * @instance
   */
  this.audio = audioConstraints;
  /**
   * @member {Owt.Base.MediaStreamTrackDeviceConstraintsForVideo} Video
   * @memberof Owt.Base.MediaStreamDeviceConstraints
   * @instance
   */

  this.video = videoConstraints;
}; // eslint-disable-next-line require-jsdoc


exports.StreamConstraints = StreamConstraints;

function isVideoConstrainsForScreenCast(constraints) {
  return _typeof(constraints.video) === 'object' && constraints.video.source === MediaFormatModule.VideoSourceInfo.SCREENCAST;
}
/**
 * @class MediaStreamFactory
 * @classDesc A factory to create MediaStream. You can also create MediaStream by yourself.
 * @memberof Owt.Base
 */


var MediaStreamFactory =
/*#__PURE__*/
function () {
  function MediaStreamFactory() {
    _classCallCheck(this, MediaStreamFactory);
  }

  _createClass(MediaStreamFactory, null, [{
    key: "createMediaStream",

    /**
     * @function createMediaStream
     * @static
     * @desc Create a MediaStream with given constraints. If you want to create a MediaStream for screen cast, please make sure both audio and video's source are "screen-cast".
     * @memberof Owt.Base.MediaStreamFactory
     * @returns {Promise<MediaStream, Error>} Return a promise that is resolved when stream is successfully created, or rejected if one of the following error happened:
     * - One or more parameters cannot be satisfied.
     * - Specified device is busy.
     * - Cannot obtain necessary permission or operation is canceled by user.
     * - Video source is screen cast, while audio source is not.
     * - Audio source is screen cast, while video source is disabled.
     * @param {Owt.Base.StreamConstraints} constraints
     */
    value: function createMediaStream(constraints) {
      if (_typeof(constraints) !== 'object' || !constraints.audio && !constraints.video) {
        return Promise.reject(new TypeError('Invalid constrains'));
      }

      if (!isVideoConstrainsForScreenCast(constraints) && _typeof(constraints.audio) === 'object' && constraints.audio.source === MediaFormatModule.AudioSourceInfo.SCREENCAST) {
        return Promise.reject(new TypeError('Cannot share screen without video.'));
      }

      if (isVideoConstrainsForScreenCast(constraints) && _typeof(constraints.audio) === 'object' && constraints.audio.source !== MediaFormatModule.AudioSourceInfo.SCREENCAST) {
        return Promise.reject(new TypeError('Cannot capture video from screen cast while capture audio from' + ' other source.'));
      } // Check and convert constraints.


      if (!constraints.audio && !constraints.video) {
        return Promise.reject(new TypeError('At least one of audio and video must be requested.'));
      }

      var mediaConstraints = Object.create({});

      if (_typeof(constraints.audio) === 'object' && constraints.audio.source === MediaFormatModule.AudioSourceInfo.MIC) {
        mediaConstraints.audio = Object.create({});

        if (utils.isEdge()) {
          mediaConstraints.audio.deviceId = constraints.audio.deviceId;
        } else {
          mediaConstraints.audio.deviceId = {
            exact: constraints.audio.deviceId
          };
        }
      } else {
        if (constraints.audio.source === MediaFormatModule.AudioSourceInfo.SCREENCAST) {
          mediaConstraints.audio = true;
        } else {
          mediaConstraints.audio = constraints.audio;
        }
      }

      if (_typeof(constraints.video) === 'object') {
        mediaConstraints.video = Object.create({});

        if (typeof constraints.video.frameRate === 'number') {
          mediaConstraints.video.frameRate = constraints.video.frameRate;
        }

        if (constraints.video.resolution && constraints.video.resolution.width && constraints.video.resolution.height) {
          if (constraints.video.source === MediaFormatModule.VideoSourceInfo.SCREENCAST) {
            mediaConstraints.video.width = constraints.video.resolution.width;
            mediaConstraints.video.height = constraints.video.resolution.height;
          } else {
            mediaConstraints.video.width = Object.create({});
            mediaConstraints.video.width.exact = constraints.video.resolution.width;
            mediaConstraints.video.height = Object.create({});
            mediaConstraints.video.height.exact = constraints.video.resolution.height;
          }
        }

        if (typeof constraints.video.deviceId === 'string') {
          mediaConstraints.video.deviceId = {
            exact: constraints.video.deviceId
          };
        }

        if (utils.isFirefox() && constraints.video.source === MediaFormatModule.VideoSourceInfo.SCREENCAST) {
          mediaConstraints.video.mediaSource = 'screen';
        }
      } else {
        mediaConstraints.video = constraints.video;
      }

      if (isVideoConstrainsForScreenCast(constraints)) {
        return navigator.mediaDevices.getDisplayMedia(mediaConstraints);
      } else {
        return navigator.mediaDevices.getUserMedia(mediaConstraints);
      }
    }
  }]);

  return MediaStreamFactory;
}();

exports.MediaStreamFactory = MediaStreamFactory;

},{"./logger.js":5,"./mediaformat.js":6,"./utils.js":11}],8:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PublishOptions = exports.Publication = exports.PublicationSettings = exports.VideoPublicationSettings = exports.AudioPublicationSettings = void 0;

var Utils = _interopRequireWildcard(require("./utils.js"));

var MediaFormat = _interopRequireWildcard(require("./mediaformat.js"));

var _event = require("../base/event.js");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * @class AudioPublicationSettings
 * @memberOf Owt.Base
 * @classDesc The audio settings of a publication.
 * @hideconstructor
 */
var AudioPublicationSettings = // eslint-disable-next-line require-jsdoc
function AudioPublicationSettings(codec) {
  _classCallCheck(this, AudioPublicationSettings);

  /**
   * @member {?Owt.Base.AudioCodecParameters} codec
   * @instance
   * @memberof Owt.Base.AudioPublicationSettings
   */
  this.codec = codec;
};
/**
 * @class VideoPublicationSettings
 * @memberOf Owt.Base
 * @classDesc The video settings of a publication.
 * @hideconstructor
 */


exports.AudioPublicationSettings = AudioPublicationSettings;

var VideoPublicationSettings = // eslint-disable-next-line require-jsdoc
function VideoPublicationSettings(codec, resolution, frameRate, bitrate, keyFrameInterval, rid) {
  _classCallCheck(this, VideoPublicationSettings);

  /**
   * @member {?Owt.Base.VideoCodecParameters} codec
   * @instance
   * @memberof Owt.Base.VideoPublicationSettings
   */
  this.codec = codec,
  /**
   * @member {?Owt.Base.Resolution} resolution
   * @instance
   * @memberof Owt.Base.VideoPublicationSettings
   */
  this.resolution = resolution;
  /**
   * @member {?number} frameRates
   * @instance
   * @classDesc Frames per second.
   * @memberof Owt.Base.VideoPublicationSettings
   */

  this.frameRate = frameRate;
  /**
   * @member {?number} bitrate
   * @instance
   * @memberof Owt.Base.VideoPublicationSettings
   */

  this.bitrate = bitrate;
  /**
   * @member {?number} keyFrameIntervals
   * @instance
   * @classDesc The time interval between key frames. Unit: second.
   * @memberof Owt.Base.VideoPublicationSettings
   */

  this.keyFrameInterval = keyFrameInterval;
  /**
   * @member {?number} rid
   * @instance
   * @classDesc Restriction identifier to identify the RTP Streams within an RTP session.
   * @memberof Owt.Base.VideoPublicationSettings
   */

  this.rid = rid;
};
/**
 * @class PublicationSettings
 * @memberOf Owt.Base
 * @classDesc The settings of a publication.
 * @hideconstructor
 */


exports.VideoPublicationSettings = VideoPublicationSettings;

var PublicationSettings = // eslint-disable-next-line require-jsdoc
function PublicationSettings(audio, video) {
  _classCallCheck(this, PublicationSettings);

  /**
   * @member {Owt.Base.AudioPublicationSettings[]} audio
   * @instance
   * @memberof Owt.Base.PublicationSettings
   */
  this.audio = audio;
  /**
   * @member {Owt.Base.VideoPublicationSettings[]} video
   * @instance
   * @memberof Owt.Base.PublicationSettings
   */

  this.video = video;
};
/**
 * @class Publication
 * @extends Owt.Base.EventDispatcher
 * @memberOf Owt.Base
 * @classDesc Publication represents a sender for publishing a stream. It
 * handles the actions on a LocalStream published to a conference.
 *
 * Events:
 *
 * | Event Name      | Argument Type    | Fired when       |
 * | ----------------| ---------------- | ---------------- |
 * | ended           | Event            | Publication is ended. |
 * | error           | ErrorEvent       | An error occurred on the publication. |
 * | mute            | MuteEvent        | Publication is muted. Client stopped sending audio and/or video data to remote endpoint. |
 * | unmute          | MuteEvent        | Publication is unmuted. Client continued sending audio and/or video data to remote endpoint. |
 *
 * `ended` event may not be fired on Safari after calling `Publication.stop()`.
 *
 * @hideconstructor
 */


exports.PublicationSettings = PublicationSettings;

var Publication =
/*#__PURE__*/
function (_EventDispatcher) {
  _inherits(Publication, _EventDispatcher);

  // eslint-disable-next-line require-jsdoc
  function Publication(id, stop, getStats, mute, unmute) {
    var _this;

    _classCallCheck(this, Publication);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(Publication).call(this));
    /**
     * @member {string} id
     * @instance
     * @memberof Owt.Base.Publication
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'id', {
      configurable: false,
      writable: false,
      value: id ? id : Utils.createUuid()
    });
    /**
     * @function stop
     * @instance
     * @desc Stop certain publication. Once a subscription is stopped, it cannot be recovered.
     * @memberof Owt.Base.Publication
     * @returns {undefined}
     */

    _this.stop = stop;
    /**
     * @function getStats
     * @instance
     * @desc Get stats of underlying PeerConnection.
     * @memberof Owt.Base.Publication
     * @returns {Promise<RTCStatsReport, Error>}
     */

    _this.getStats = getStats;
    /**
     * @function mute
     * @instance
     * @desc Stop sending data to remote endpoint.
     * @memberof Owt.Base.Publication
     * @param {Owt.Base.TrackKind } kind Kind of tracks to be muted.
     * @returns {Promise<undefined, Error>}
     */

    _this.mute = mute;
    /**
     * @function unmute
     * @instance
     * @desc Continue sending data to remote endpoint.
     * @memberof Owt.Base.Publication
     * @param {Owt.Base.TrackKind } kind Kind of tracks to be unmuted.
     * @returns {Promise<undefined, Error>}
     */

    _this.unmute = unmute;
    return _this;
  }

  return Publication;
}(_event.EventDispatcher);
/**
 * @class PublishOptions
 * @memberOf Owt.Base
 * @classDesc PublishOptions defines options for publishing a Owt.Base.LocalStream.
 */


exports.Publication = Publication;

var PublishOptions = // eslint-disable-next-line require-jsdoc
function PublishOptions(audio, video) {
  _classCallCheck(this, PublishOptions);

  /**
   * @member {?Array<Owt.Base.AudioEncodingParameters> | ?Array<RTCRtpEncodingParameters>} audio
   * @instance
   * @memberof Owt.Base.PublishOptions
   * @desc Parameters for audio RtpSender. Publishing with RTCRtpEncodingParameters is an experimental feature. It is subject to change.
   */
  this.audio = audio;
  /**
   * @member {?Array<Owt.Base.VideoEncodingParameters> | ?Array<RTCRtpEncodingParameters>} video
   * @instance
   * @memberof Owt.Base.PublishOptions
   * @desc Parameters for video RtpSender. Publishing with RTCRtpEncodingParameters is an experimental feature. It is subject to change.
   */

  this.video = video;
};

exports.PublishOptions = PublishOptions;

},{"../base/event.js":3,"./mediaformat.js":6,"./utils.js":11}],9:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.reorderCodecs = reorderCodecs;
exports.addLegacySimulcast = addLegacySimulcast;
exports.setMaxBitrate = setMaxBitrate;

var _logger = _interopRequireDefault(require("./logger.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* More information about these options at jshint.com/docs/options */

/* eslint-disable */

/* globals  adapter, trace */

/* exported setCodecParam, iceCandidateType, formatTypePreference,
   maybeSetOpusOptions, maybePreferAudioReceiveCodec,
   maybePreferAudioSendCodec, maybeSetAudioReceiveBitRate,
   maybeSetAudioSendBitRate, maybePreferVideoReceiveCodec,
   maybePreferVideoSendCodec, maybeSetVideoReceiveBitRate,
   maybeSetVideoSendBitRate, maybeSetVideoSendInitialBitRate,
   maybeRemoveVideoFec, mergeConstraints, removeCodecParam*/

/* This file is borrowed from apprtc with some modifications. */

/* Commit hash: c6af0c25e9af527f71b3acdd6bfa1389d778f7bd + PR 530 */
'use strict';

function mergeConstraints(cons1, cons2) {
  if (!cons1 || !cons2) {
    return cons1 || cons2;
  }

  var merged = cons1;

  for (var key in cons2) {
    merged[key] = cons2[key];
  }

  return merged;
}

function iceCandidateType(candidateStr) {
  return candidateStr.split(' ')[7];
} // Turns the local type preference into a human-readable string.
// Note that this mapping is browser-specific.


function formatTypePreference(pref) {
  if (adapter.browserDetails.browser === 'chrome') {
    switch (pref) {
      case 0:
        return 'TURN/TLS';

      case 1:
        return 'TURN/TCP';

      case 2:
        return 'TURN/UDP';

      default:
        break;
    }
  } else if (adapter.browserDetails.browser === 'firefox') {
    switch (pref) {
      case 0:
        return 'TURN/TCP';

      case 5:
        return 'TURN/UDP';

      default:
        break;
    }
  }

  return '';
}

function maybeSetOpusOptions(sdp, params) {
  // Set Opus in Stereo, if stereo is true, unset it, if stereo is false, and
  // do nothing if otherwise.
  if (params.opusStereo === 'true') {
    sdp = setCodecParam(sdp, 'opus/48000', 'stereo', '1');
  } else if (params.opusStereo === 'false') {
    sdp = removeCodecParam(sdp, 'opus/48000', 'stereo');
  } // Set Opus FEC, if opusfec is true, unset it, if opusfec is false, and
  // do nothing if otherwise.


  if (params.opusFec === 'true') {
    sdp = setCodecParam(sdp, 'opus/48000', 'useinbandfec', '1');
  } else if (params.opusFec === 'false') {
    sdp = removeCodecParam(sdp, 'opus/48000', 'useinbandfec');
  } // Set Opus DTX, if opusdtx is true, unset it, if opusdtx is false, and
  // do nothing if otherwise.


  if (params.opusDtx === 'true') {
    sdp = setCodecParam(sdp, 'opus/48000', 'usedtx', '1');
  } else if (params.opusDtx === 'false') {
    sdp = removeCodecParam(sdp, 'opus/48000', 'usedtx');
  } // Set Opus maxplaybackrate, if requested.


  if (params.opusMaxPbr) {
    sdp = setCodecParam(sdp, 'opus/48000', 'maxplaybackrate', params.opusMaxPbr);
  }

  return sdp;
}

function maybeSetAudioSendBitRate(sdp, params) {
  if (!params.audioSendBitrate) {
    return sdp;
  }

  _logger.default.debug('Prefer audio send bitrate: ' + params.audioSendBitrate);

  return preferBitRate(sdp, params.audioSendBitrate, 'audio');
}

function maybeSetAudioReceiveBitRate(sdp, params) {
  if (!params.audioRecvBitrate) {
    return sdp;
  }

  _logger.default.debug('Prefer audio receive bitrate: ' + params.audioRecvBitrate);

  return preferBitRate(sdp, params.audioRecvBitrate, 'audio');
}

function maybeSetVideoSendBitRate(sdp, params) {
  if (!params.videoSendBitrate) {
    return sdp;
  }

  _logger.default.debug('Prefer video send bitrate: ' + params.videoSendBitrate);

  return preferBitRate(sdp, params.videoSendBitrate, 'video');
}

function maybeSetVideoReceiveBitRate(sdp, params) {
  if (!params.videoRecvBitrate) {
    return sdp;
  }

  _logger.default.debug('Prefer video receive bitrate: ' + params.videoRecvBitrate);

  return preferBitRate(sdp, params.videoRecvBitrate, 'video');
} // Add a b=AS:bitrate line to the m=mediaType section.


function preferBitRate(sdp, bitrate, mediaType) {
  var sdpLines = sdp.split('\r\n'); // Find m line for the given mediaType.

  var mLineIndex = findLine(sdpLines, 'm=', mediaType);

  if (mLineIndex === null) {
    _logger.default.debug('Failed to add bandwidth line to sdp, as no m-line found');

    return sdp;
  } // Find next m-line if any.


  var nextMLineIndex = findLineInRange(sdpLines, mLineIndex + 1, -1, 'm=');

  if (nextMLineIndex === null) {
    nextMLineIndex = sdpLines.length;
  } // Find c-line corresponding to the m-line.


  var cLineIndex = findLineInRange(sdpLines, mLineIndex + 1, nextMLineIndex, 'c=');

  if (cLineIndex === null) {
    _logger.default.debug('Failed to add bandwidth line to sdp, as no c-line found');

    return sdp;
  } // Check if bandwidth line already exists between c-line and next m-line.


  var bLineIndex = findLineInRange(sdpLines, cLineIndex + 1, nextMLineIndex, 'b=AS');

  if (bLineIndex) {
    sdpLines.splice(bLineIndex, 1);
  } // Create the b (bandwidth) sdp line.


  var bwLine = 'b=AS:' + bitrate; // As per RFC 4566, the b line should follow after c-line.

  sdpLines.splice(cLineIndex + 1, 0, bwLine);
  sdp = sdpLines.join('\r\n');
  return sdp;
} // Add an a=fmtp: x-google-min-bitrate=kbps line, if videoSendInitialBitrate
// is specified. We'll also add a x-google-min-bitrate value, since the max
// must be >= the min.


function maybeSetVideoSendInitialBitRate(sdp, params) {
  var initialBitrate = parseInt(params.videoSendInitialBitrate);

  if (!initialBitrate) {
    return sdp;
  } // Validate the initial bitrate value.


  var maxBitrate = parseInt(initialBitrate);
  var bitrate = parseInt(params.videoSendBitrate);

  if (bitrate) {
    if (initialBitrate > bitrate) {
      _logger.default.debug('Clamping initial bitrate to max bitrate of ' + bitrate + ' kbps.');

      initialBitrate = bitrate;
      params.videoSendInitialBitrate = initialBitrate;
    }

    maxBitrate = bitrate;
  }

  var sdpLines = sdp.split('\r\n'); // Search for m line.

  var mLineIndex = findLine(sdpLines, 'm=', 'video');

  if (mLineIndex === null) {
    _logger.default.debug('Failed to find video m-line');

    return sdp;
  } // Figure out the first codec payload type on the m=video SDP line.


  var videoMLine = sdpLines[mLineIndex];
  var pattern = new RegExp('m=video\\s\\d+\\s[A-Z/]+\\s');
  var sendPayloadType = videoMLine.split(pattern)[1].split(' ')[0];
  var fmtpLine = sdpLines[findLine(sdpLines, 'a=rtpmap', sendPayloadType)];
  var codecName = fmtpLine.split('a=rtpmap:' + sendPayloadType)[1].split('/')[0]; // Use codec from params if specified via URL param, otherwise use from SDP.

  var codec = params.videoSendCodec || codecName;
  sdp = setCodecParam(sdp, codec, 'x-google-min-bitrate', params.videoSendInitialBitrate.toString());
  sdp = setCodecParam(sdp, codec, 'x-google-max-bitrate', maxBitrate.toString());
  return sdp;
}

function removePayloadTypeFromMline(mLine, payloadType) {
  mLine = mLine.split(' ');

  for (var i = 0; i < mLine.length; ++i) {
    if (mLine[i] === payloadType.toString()) {
      mLine.splice(i, 1);
    }
  }

  return mLine.join(' ');
}

function removeCodecByName(sdpLines, codec) {
  var index = findLine(sdpLines, 'a=rtpmap', codec);

  if (index === null) {
    return sdpLines;
  }

  var payloadType = getCodecPayloadTypeFromLine(sdpLines[index]);
  sdpLines.splice(index, 1); // Search for the video m= line and remove the codec.

  var mLineIndex = findLine(sdpLines, 'm=', 'video');

  if (mLineIndex === null) {
    return sdpLines;
  }

  sdpLines[mLineIndex] = removePayloadTypeFromMline(sdpLines[mLineIndex], payloadType);
  return sdpLines;
}

function removeCodecByPayloadType(sdpLines, payloadType) {
  var index = findLine(sdpLines, 'a=rtpmap', payloadType.toString());

  if (index === null) {
    return sdpLines;
  }

  sdpLines.splice(index, 1); // Search for the video m= line and remove the codec.

  var mLineIndex = findLine(sdpLines, 'm=', 'video');

  if (mLineIndex === null) {
    return sdpLines;
  }

  sdpLines[mLineIndex] = removePayloadTypeFromMline(sdpLines[mLineIndex], payloadType);
  return sdpLines;
}

function maybeRemoveVideoFec(sdp, params) {
  if (params.videoFec !== 'false') {
    return sdp;
  }

  var sdpLines = sdp.split('\r\n');
  var index = findLine(sdpLines, 'a=rtpmap', 'red');

  if (index === null) {
    return sdp;
  }

  var redPayloadType = getCodecPayloadTypeFromLine(sdpLines[index]);
  sdpLines = removeCodecByPayloadType(sdpLines, redPayloadType);
  sdpLines = removeCodecByName(sdpLines, 'ulpfec'); // Remove fmtp lines associated with red codec.

  index = findLine(sdpLines, 'a=fmtp', redPayloadType.toString());

  if (index === null) {
    return sdp;
  }

  var fmtpLine = parseFmtpLine(sdpLines[index]);
  var rtxPayloadType = fmtpLine.pt;

  if (rtxPayloadType === null) {
    return sdp;
  }

  sdpLines.splice(index, 1);
  sdpLines = removeCodecByPayloadType(sdpLines, rtxPayloadType);
  return sdpLines.join('\r\n');
} // Promotes |audioSendCodec| to be the first in the m=audio line, if set.


function maybePreferAudioSendCodec(sdp, params) {
  return maybePreferCodec(sdp, 'audio', 'send', params.audioSendCodec);
} // Promotes |audioRecvCodec| to be the first in the m=audio line, if set.


function maybePreferAudioReceiveCodec(sdp, params) {
  return maybePreferCodec(sdp, 'audio', 'receive', params.audioRecvCodec);
} // Promotes |videoSendCodec| to be the first in the m=audio line, if set.


function maybePreferVideoSendCodec(sdp, params) {
  return maybePreferCodec(sdp, 'video', 'send', params.videoSendCodec);
} // Promotes |videoRecvCodec| to be the first in the m=audio line, if set.


function maybePreferVideoReceiveCodec(sdp, params) {
  return maybePreferCodec(sdp, 'video', 'receive', params.videoRecvCodec);
} // Sets |codec| as the default |type| codec if it's present.
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.


function maybePreferCodec(sdp, type, dir, codec) {
  var str = type + ' ' + dir + ' codec';

  if (!codec) {
    _logger.default.debug('No preference on ' + str + '.');

    return sdp;
  }

  _logger.default.debug('Prefer ' + str + ': ' + codec);

  var sdpLines = sdp.split('\r\n'); // Search for m line.

  var mLineIndex = findLine(sdpLines, 'm=', type);

  if (mLineIndex === null) {
    return sdp;
  } // If the codec is available, set it as the default in m line.


  var payload = null;

  for (var i = 0; i < sdpLines.length; i++) {
    var index = findLineInRange(sdpLines, i, -1, 'a=rtpmap', codec);

    if (index !== null) {
      payload = getCodecPayloadTypeFromLine(sdpLines[index]);

      if (payload) {
        sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
      }
    }
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
} // Set fmtp param to specific codec in SDP. If param does not exists, add it.


function setCodecParam(sdp, codec, param, value) {
  var sdpLines = sdp.split('\r\n'); // SDPs sent from MCU use \n as line break.

  if (sdpLines.length <= 1) {
    sdpLines = sdp.split('\n');
  }

  var fmtpLineIndex = findFmtpLine(sdpLines, codec);
  var fmtpObj = {};

  if (fmtpLineIndex === null) {
    var index = findLine(sdpLines, 'a=rtpmap', codec);

    if (index === null) {
      return sdp;
    }

    var payload = getCodecPayloadTypeFromLine(sdpLines[index]);
    fmtpObj.pt = payload.toString();
    fmtpObj.params = {};
    fmtpObj.params[param] = value;
    sdpLines.splice(index + 1, 0, writeFmtpLine(fmtpObj));
  } else {
    fmtpObj = parseFmtpLine(sdpLines[fmtpLineIndex]);
    fmtpObj.params[param] = value;
    sdpLines[fmtpLineIndex] = writeFmtpLine(fmtpObj);
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
} // Remove fmtp param if it exists.


function removeCodecParam(sdp, codec, param) {
  var sdpLines = sdp.split('\r\n');
  var fmtpLineIndex = findFmtpLine(sdpLines, codec);

  if (fmtpLineIndex === null) {
    return sdp;
  }

  var map = parseFmtpLine(sdpLines[fmtpLineIndex]);
  delete map.params[param];
  var newLine = writeFmtpLine(map);

  if (newLine === null) {
    sdpLines.splice(fmtpLineIndex, 1);
  } else {
    sdpLines[fmtpLineIndex] = newLine;
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
} // Split an fmtp line into an object including 'pt' and 'params'.


function parseFmtpLine(fmtpLine) {
  var fmtpObj = {};
  var spacePos = fmtpLine.indexOf(' ');
  var keyValues = fmtpLine.substring(spacePos + 1).split(';');
  var pattern = new RegExp('a=fmtp:(\\d+)');
  var result = fmtpLine.match(pattern);

  if (result && result.length === 2) {
    fmtpObj.pt = result[1];
  } else {
    return null;
  }

  var params = {};

  for (var i = 0; i < keyValues.length; ++i) {
    var pair = keyValues[i].split('=');

    if (pair.length === 2) {
      params[pair[0]] = pair[1];
    }
  }

  fmtpObj.params = params;
  return fmtpObj;
} // Generate an fmtp line from an object including 'pt' and 'params'.


function writeFmtpLine(fmtpObj) {
  if (!fmtpObj.hasOwnProperty('pt') || !fmtpObj.hasOwnProperty('params')) {
    return null;
  }

  var pt = fmtpObj.pt;
  var params = fmtpObj.params;
  var keyValues = [];
  var i = 0;

  for (var key in params) {
    keyValues[i] = key + '=' + params[key];
    ++i;
  }

  if (i === 0) {
    return null;
  }

  return 'a=fmtp:' + pt.toString() + ' ' + keyValues.join(';');
} // Find fmtp attribute for |codec| in |sdpLines|.


function findFmtpLine(sdpLines, codec) {
  // Find payload of codec.
  var payload = getCodecPayloadType(sdpLines, codec); // Find the payload in fmtp line.

  return payload ? findLine(sdpLines, 'a=fmtp:' + payload.toString()) : null;
} // Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).


function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
} // Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).


function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  var realEndLine = endLine !== -1 ? endLine : sdpLines.length;

  for (var i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (!substr || sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
        return i;
      }
    }
  }

  return null;
} // Gets the codec payload type from sdp lines.


function getCodecPayloadType(sdpLines, codec) {
  var index = findLine(sdpLines, 'a=rtpmap', codec);
  return index ? getCodecPayloadTypeFromLine(sdpLines[index]) : null;
} // Gets the codec payload type from an a=rtpmap:X line.


function getCodecPayloadTypeFromLine(sdpLine) {
  var pattern = new RegExp('a=rtpmap:(\\d+) [a-zA-Z0-9-]+\\/\\d+');
  var result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
} // Returns a new m= line with the specified codec as the first one.


function setDefaultCodec(mLine, payload) {
  var elements = mLine.split(' '); // Just copy the first three parameters; codec order starts on fourth.

  var newLine = elements.slice(0, 3); // Put target payload first and copy in the rest.

  newLine.push(payload);

  for (var i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }

  return newLine.join(' ');
}
/* Below are newly added functions */
// Following codecs will not be removed from SDP event they are not in the
// user-specified codec list.


var audioCodecWhiteList = ['CN', 'telephone-event'];
var videoCodecWhiteList = ['red', 'ulpfec']; // Returns a new m= line with the specified codec order.

function setCodecOrder(mLine, payloads) {
  var elements = mLine.split(' '); // Just copy the first three parameters; codec order starts on fourth.

  var newLine = elements.slice(0, 3); // Concat payload types.

  newLine = newLine.concat(payloads);
  return newLine.join(' ');
} // Append RTX payloads for existing payloads.


function appendRtxPayloads(sdpLines, payloads) {
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = payloads[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var payload = _step.value;
      var index = findLine(sdpLines, 'a=fmtp', 'apt=' + payload);

      if (index !== null) {
        var fmtpLine = parseFmtpLine(sdpLines[index]);
        payloads.push(fmtpLine.pt);
      }
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator.return != null) {
        _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  return payloads;
} // Remove a codec with all its associated a lines.


function removeCodecFramALine(sdpLines, payload) {
  var pattern = new RegExp('a=(rtpmap|rtcp-fb|fmtp):' + payload + '\\s');

  for (var i = sdpLines.length - 1; i > 0; i--) {
    if (sdpLines[i].match(pattern)) {
      sdpLines.splice(i, 1);
    }
  }

  return sdpLines;
} // Reorder codecs in m-line according the order of |codecs|. Remove codecs from
// m-line if it is not present in |codecs|
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.


function reorderCodecs(sdp, type, codecs) {
  if (!codecs || codecs.length === 0) {
    return sdp;
  }

  codecs = type === 'audio' ? codecs.concat(audioCodecWhiteList) : codecs.concat(videoCodecWhiteList);
  var sdpLines = sdp.split('\r\n'); // Search for m line.

  var mLineIndex = findLine(sdpLines, 'm=', type);

  if (mLineIndex === null) {
    return sdp;
  }

  var originPayloads = sdpLines[mLineIndex].split(' ');
  originPayloads.splice(0, 3); // If the codec is available, set it as the default in m line.

  var payloads = [];
  var _iteratorNormalCompletion2 = true;
  var _didIteratorError2 = false;
  var _iteratorError2 = undefined;

  try {
    for (var _iterator2 = codecs[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
      var codec = _step2.value;

      for (var i = 0; i < sdpLines.length; i++) {
        var index = findLineInRange(sdpLines, i, -1, 'a=rtpmap', codec);

        if (index !== null) {
          var payload = getCodecPayloadTypeFromLine(sdpLines[index]);

          if (payload) {
            payloads.push(payload);
            i = index;
          }
        }
      }
    }
  } catch (err) {
    _didIteratorError2 = true;
    _iteratorError2 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
        _iterator2.return();
      }
    } finally {
      if (_didIteratorError2) {
        throw _iteratorError2;
      }
    }
  }

  payloads = appendRtxPayloads(sdpLines, payloads);
  sdpLines[mLineIndex] = setCodecOrder(sdpLines[mLineIndex], payloads); // Remove a lines.

  var _iteratorNormalCompletion3 = true;
  var _didIteratorError3 = false;
  var _iteratorError3 = undefined;

  try {
    for (var _iterator3 = originPayloads[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
      var _payload = _step3.value;

      if (payloads.indexOf(_payload) === -1) {
        sdpLines = removeCodecFramALine(sdpLines, _payload);
      }
    }
  } catch (err) {
    _didIteratorError3 = true;
    _iteratorError3 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
        _iterator3.return();
      }
    } finally {
      if (_didIteratorError3) {
        throw _iteratorError3;
      }
    }
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
} // Add legacy simulcast.


function addLegacySimulcast(sdp, type, numStreams) {
  var _sdpLines, _sdpLines2;

  if (!numStreams || !(numStreams > 1)) {
    return sdp;
  }

  var sdpLines = sdp.split('\r\n'); // Search for m line.

  var mLineStart = findLine(sdpLines, 'm=', type);

  if (mLineStart === null) {
    return sdp;
  }

  var mLineEnd = findLineInRange(sdpLines, mLineStart + 1, -1, 'm=');

  if (mLineEnd === null) {
    mLineEnd = sdpLines.length;
  }

  var ssrcGetter = function ssrcGetter(line) {
    var parts = line.split(' ');
    var ssrc = parts[0].split(':')[1];
    return ssrc;
  }; // Process ssrc lines from mLineIndex.


  var removes = new Set();
  var ssrcs = new Set();
  var gssrcs = new Set();
  var simLines = [];
  var simGroupLines = [];
  var i = mLineStart + 1;

  while (i < mLineEnd) {
    var line = sdpLines[i];

    if (line === '') {
      break;
    }

    if (line.indexOf('a=ssrc:') > -1) {
      var ssrc = ssrcGetter(sdpLines[i]);
      ssrcs.add(ssrc);

      if (line.indexOf('cname') > -1 || line.indexOf('msid') > -1) {
        for (var j = 1; j < numStreams; j++) {
          var nssrc = parseInt(ssrc) + j + '';
          simLines.push(line.replace(ssrc, nssrc));
        }
      } else {
        removes.add(line);
      }
    }

    if (line.indexOf('a=ssrc-group:FID') > -1) {
      var parts = line.split(' ');
      gssrcs.add(parts[2]);

      for (var _j = 1; _j < numStreams; _j++) {
        var nssrc1 = parseInt(parts[1]) + _j + '';
        var nssrc2 = parseInt(parts[2]) + _j + '';
        simGroupLines.push(line.replace(parts[1], nssrc1).replace(parts[2], nssrc2));
      }
    }

    i++;
  }

  var insertPos = i;
  ssrcs.forEach(function (ssrc) {
    if (!gssrcs.has(ssrc)) {
      var groupLine = 'a=ssrc-group:SIM';
      groupLine = groupLine + ' ' + ssrc;

      for (var _j2 = 1; _j2 < numStreams; _j2++) {
        groupLine = groupLine + ' ' + (parseInt(ssrc) + _j2);
      }

      simGroupLines.push(groupLine);
    }
  });
  simLines.sort(); // Insert simulcast ssrc lines.

  (_sdpLines = sdpLines).splice.apply(_sdpLines, [insertPos, 0].concat(simGroupLines));

  (_sdpLines2 = sdpLines).splice.apply(_sdpLines2, [insertPos, 0].concat(simLines));

  sdpLines = sdpLines.filter(function (line) {
    return !removes.has(line);
  });
  sdp = sdpLines.join('\r\n');
  return sdp;
}

function setMaxBitrate(sdp, encodingParametersList) {
  var _iteratorNormalCompletion4 = true;
  var _didIteratorError4 = false;
  var _iteratorError4 = undefined;

  try {
    for (var _iterator4 = encodingParametersList[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
      var encodingParameters = _step4.value;

      if (encodingParameters.maxBitrate) {
        sdp = setCodecParam(sdp, encodingParameters.codec.name, 'x-google-max-bitrate', encodingParameters.maxBitrate.toString());
      }
    }
  } catch (err) {
    _didIteratorError4 = true;
    _iteratorError4 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion4 && _iterator4.return != null) {
        _iterator4.return();
      }
    } finally {
      if (_didIteratorError4) {
        throw _iteratorError4;
      }
    }
  }

  return sdp;
}

},{"./logger.js":5}],10:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StreamEvent = exports.RemoteStream = exports.LocalStream = exports.Stream = exports.StreamSourceInfo = void 0;

var _logger = _interopRequireDefault(require("./logger.js"));

var _event = require("./event.js");

var Utils = _interopRequireWildcard(require("./utils.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// eslint-disable-next-line require-jsdoc
function isAllowedValue(obj, allowedValues) {
  return allowedValues.some(function (ele) {
    return ele === obj;
  });
}
/**
 * @class StreamSourceInfo
 * @memberOf Owt.Base
 * @classDesc Information of a stream's source.
 * @constructor
 * @description Audio source info or video source info could be undefined if a stream does not have audio/video track.
 * @param {?string} audioSourceInfo Audio source info. Accepted values are: "mic", "screen-cast", "file", "mixed" or undefined.
 * @param {?string} videoSourceInfo Video source info. Accepted values are: "camera", "screen-cast", "file", "mixed" or undefined.
 */


var StreamSourceInfo = // eslint-disable-next-line require-jsdoc
function StreamSourceInfo(audioSourceInfo, videoSourceInfo) {
  _classCallCheck(this, StreamSourceInfo);

  if (!isAllowedValue(audioSourceInfo, [undefined, 'mic', 'screen-cast', 'file', 'mixed'])) {
    throw new TypeError('Incorrect value for audioSourceInfo');
  }

  if (!isAllowedValue(videoSourceInfo, [undefined, 'camera', 'screen-cast', 'file', 'encoded-file', 'raw-file', 'mixed'])) {
    throw new TypeError('Incorrect value for videoSourceInfo');
  }

  this.audio = audioSourceInfo;
  this.video = videoSourceInfo;
};
/**
 * @class Stream
 * @memberOf Owt.Base
 * @classDesc Base class of streams.
 * @extends Owt.Base.EventDispatcher
 * @hideconstructor
 */


exports.StreamSourceInfo = StreamSourceInfo;

var Stream =
/*#__PURE__*/
function (_EventDispatcher) {
  _inherits(Stream, _EventDispatcher);

  // eslint-disable-next-line require-jsdoc
  function Stream(stream, sourceInfo, attributes) {
    var _this;

    _classCallCheck(this, Stream);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(Stream).call(this));

    if (stream && !(stream instanceof MediaStream) || _typeof(sourceInfo) !== 'object') {
      throw new TypeError('Invalid stream or sourceInfo.');
    }

    if (stream && (stream.getAudioTracks().length > 0 && !sourceInfo.audio || stream.getVideoTracks().length > 0 && !sourceInfo.video)) {
      throw new TypeError('Missing audio source info or video source info.');
    }
    /**
     * @member {?MediaStream} mediaStream
     * @instance
     * @memberof Owt.Base.Stream
     * @see {@link https://www.w3.org/TR/mediacapture-streams/#mediastream|MediaStream API of Media Capture and Streams}.
     */


    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'mediaStream', {
      configurable: false,
      writable: true,
      value: stream
    });
    /**
     * @member {Owt.Base.StreamSourceInfo} source
     * @instance
     * @memberof Owt.Base.Stream
     * @desc Source info of a stream.
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'source', {
      configurable: false,
      writable: false,
      value: sourceInfo
    });
    /**
     * @member {object} attributes
     * @instance
     * @memberof Owt.Base.Stream
     * @desc Custom attributes of a stream.
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'attributes', {
      configurable: true,
      writable: false,
      value: attributes
    });
    return _this;
  }

  return Stream;
}(_event.EventDispatcher);
/**
 * @class LocalStream
 * @classDesc Stream captured from current endpoint.
 * @memberOf Owt.Base
 * @extends Owt.Base.Stream
 * @constructor
 * @param {MediaStream} stream Underlying MediaStream.
 * @param {Owt.Base.StreamSourceInfo} sourceInfo Information about stream's source.
 * @param {object} attributes Custom attributes of the stream.
 */


exports.Stream = Stream;

var LocalStream =
/*#__PURE__*/
function (_Stream) {
  _inherits(LocalStream, _Stream);

  // eslint-disable-next-line require-jsdoc
  function LocalStream(stream, sourceInfo, attributes) {
    var _this2;

    _classCallCheck(this, LocalStream);

    if (!(stream instanceof MediaStream)) {
      throw new TypeError('Invalid stream.');
    }

    _this2 = _possibleConstructorReturn(this, _getPrototypeOf(LocalStream).call(this, stream, sourceInfo, attributes));
    /**
     * @member {string} id
     * @instance
     * @memberof Owt.Base.LocalStream
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this2)), 'id', {
      configurable: false,
      writable: false,
      value: Utils.createUuid()
    });
    return _this2;
  }

  return LocalStream;
}(Stream);
/**
 * @class RemoteStream
 * @classDesc Stream sent from a remote endpoint.
 * Events:
 *
 * | Event Name      | Argument Type    | Fired when         |
 * | ----------------| ---------------- | ------------------ |
 * | ended           | Event            | Stream is ended.   |
 * | updated         | Event            | Stream is updated. |
 *
 * @memberOf Owt.Base
 * @extends Owt.Base.Stream
 * @hideconstructor
 */


exports.LocalStream = LocalStream;

var RemoteStream =
/*#__PURE__*/
function (_Stream2) {
  _inherits(RemoteStream, _Stream2);

  // eslint-disable-next-line require-jsdoc
  function RemoteStream(id, origin, stream, sourceInfo, attributes) {
    var _this3;

    _classCallCheck(this, RemoteStream);

    _this3 = _possibleConstructorReturn(this, _getPrototypeOf(RemoteStream).call(this, stream, sourceInfo, attributes));
    /**
     * @member {string} id
     * @instance
     * @memberof Owt.Base.RemoteStream
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this3)), 'id', {
      configurable: false,
      writable: false,
      value: id ? id : Utils.createUuid()
    });
    /**
     * @member {string} origin
     * @instance
     * @memberof Owt.Base.RemoteStream
     * @desc ID of the remote endpoint who published this stream.
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this3)), 'origin', {
      configurable: false,
      writable: false,
      value: origin
    });
    /**
     * @member {Owt.Base.PublicationSettings} settings
     * @instance
     * @memberof Owt.Base.RemoteStream
     * @desc Original settings for publishing this stream. This property is only valid in conference mode.
     */

    _this3.settings = undefined;
    /**
     * @member {Owt.Conference.SubscriptionCapabilities} extraCapabilities
     * @instance
     * @memberof Owt.Base.RemoteStream
     * @desc Extra capabilities remote endpoint provides for subscription. Extra capabilities don't include original settings. This property is only valid in conference mode.
     */

    _this3.extraCapabilities = undefined;
    return _this3;
  }

  return RemoteStream;
}(Stream);
/**
 * @class StreamEvent
 * @classDesc Event for Stream.
 * @extends Owt.Base.OwtEvent
 * @memberof Owt.Base
 * @hideconstructor
 */


exports.RemoteStream = RemoteStream;

var StreamEvent =
/*#__PURE__*/
function (_OwtEvent) {
  _inherits(StreamEvent, _OwtEvent);

  // eslint-disable-next-line require-jsdoc
  function StreamEvent(type, init) {
    var _this4;

    _classCallCheck(this, StreamEvent);

    _this4 = _possibleConstructorReturn(this, _getPrototypeOf(StreamEvent).call(this, type));
    /**
     * @member {Owt.Base.Stream} stream
     * @instance
     * @memberof Owt.Base.StreamEvent
     */

    _this4.stream = init.stream;
    return _this4;
  }

  return StreamEvent;
}(_event.OwtEvent);

exports.StreamEvent = StreamEvent;

},{"./event.js":3,"./logger.js":5,"./utils.js":11}],11:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* global navigator, window */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isFirefox = isFirefox;
exports.isChrome = isChrome;
exports.isSafari = isSafari;
exports.isTauri = isTauri;
exports.isEdge = isEdge;
exports.createUuid = createUuid;
exports.sysInfo = sysInfo;
var sdkVersion = '4.3.1'; // eslint-disable-next-line require-jsdoc

function isFirefox() {
  return window.navigator.userAgent.match('Firefox') !== null;
} // eslint-disable-next-line require-jsdoc


function isChrome() {
  return window.navigator.userAgent.match('Chrome') !== null;
} // eslint-disable-next-line require-jsdoc


function isSafari() {
  return /^((?!chrome|android).)*safari/i.test(window.navigator.userAgent);
}

function isTauri() {
  return window.__TAURI_IPC__;
} // export function isSafari() {
//   return true;
// }
// eslint-disable-next-line require-jsdoc


function isEdge() {
  return window.navigator.userAgent.match(/Edge\/(\d+).(\d+)$/) !== null;
} // eslint-disable-next-line require-jsdoc


function createUuid() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : r & 0x3 | 0x8;
    return v.toString(16);
  });
} // Returns system information.
// Format: {sdk:{version:**, type:**}, runtime:{version:**, name:**}, os:{version:**, name:**}};
// eslint-disable-next-line require-jsdoc


function sysInfo() {
  var info = Object.create({});
  info.sdk = {
    version: sdkVersion,
    type: 'JavaScript'
  }; // Runtime info.

  var userAgent = navigator.userAgent;
  var firefoxRegex = /Firefox\/([0-9\.]+)/;
  var chromeRegex = /Chrome\/([0-9\.]+)/;
  var edgeRegex = /Edge\/([0-9\.]+)/;
  var safariVersionRegex = /Version\/([0-9\.]+) Safari/;
  var result = chromeRegex.exec(userAgent);

  if (result) {
    info.runtime = {
      name: 'Chrome',
      version: result[1]
    };
  } else if (result = firefoxRegex.exec(userAgent)) {
    info.runtime = {
      name: 'Firefox',
      version: result[1]
    };
  } else if (result = edgeRegex.exec(userAgent)) {
    info.runtime = {
      name: 'Edge',
      version: result[1]
    };
  } else if (isSafari()) {
    result = safariVersionRegex.exec(userAgent);
    info.runtime = {
      name: 'Safari'
    };
    info.runtime.version = result ? result[1] : 'Unknown';
  } else {
    info.runtime = {
      name: 'Unknown',
      version: 'Unknown'
    };
  } // OS info.


  var windowsRegex = /Windows NT ([0-9\.]+)/;
  var macRegex = /Intel Mac OS X ([0-9_\.]+)/;
  var iPhoneRegex = /iPhone OS ([0-9_\.]+)/;
  var linuxRegex = /X11; Linux/;
  var androidRegex = /Android( ([0-9\.]+))?/;
  var chromiumOsRegex = /CrOS/;

  if (result = windowsRegex.exec(userAgent)) {
    info.os = {
      name: 'Windows NT',
      version: result[1]
    };
  } else if (result = macRegex.exec(userAgent)) {
    info.os = {
      name: 'Mac OS X',
      version: result[1].replace(/_/g, '.')
    };
  } else if (result = iPhoneRegex.exec(userAgent)) {
    info.os = {
      name: 'iPhone OS',
      version: result[1].replace(/_/g, '.')
    };
  } else if (result = linuxRegex.exec(userAgent)) {
    info.os = {
      name: 'Linux',
      version: 'Unknown'
    };
  } else if (result = androidRegex.exec(userAgent)) {
    info.os = {
      name: 'Android',
      version: result[1] || 'Unknown'
    };
  } else if (result = chromiumOsRegex.exec(userAgent)) {
    info.os = {
      name: 'Chrome OS',
      version: 'Unknown'
    };
  } else {
    info.os = {
      name: 'Unknown',
      version: 'Unknown'
    };
  }

  info.capabilities = {
    continualIceGathering: false,
    unifiedPlan: true,
    streamRemovable: info.runtime.name !== 'Firefox'
  };
  return info;
}

},{}],12:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable require-jsdoc */

/* global Promise */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ConferencePeerConnectionChannel = void 0;

var _logger = _interopRequireDefault(require("../base/logger.js"));

var _event = require("../base/event.js");

var _mediaformat = require("../base/mediaformat.js");

var _publication = require("../base/publication.js");

var _subscription = require("./subscription.js");

var _error2 = require("./error.js");

var Utils = _interopRequireWildcard(require("../base/utils.js"));

var SdpUtils = _interopRequireWildcard(require("../base/sdputils.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

/**
 * @class ConferencePeerConnectionChannel
 * @classDesc A channel for a connection between client and conference server. Currently, only one stream could be tranmitted in a channel.
 * @hideconstructor
 * @private
 */
var ConferencePeerConnectionChannel =
/*#__PURE__*/
function (_EventDispatcher) {
  _inherits(ConferencePeerConnectionChannel, _EventDispatcher);

  // eslint-disable-next-line require-jsdoc
  function ConferencePeerConnectionChannel(config, signaling) {
    var _this;

    _classCallCheck(this, ConferencePeerConnectionChannel);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(ConferencePeerConnectionChannel).call(this));
    _this._config = config;
    _this._options = null;
    _this._videoCodecs = undefined;
    _this._signaling = signaling;
    _this._pc = null;
    _this._internalId = null; // It's publication ID or subscription ID.

    _this._pendingCandidates = [];
    _this._subscribePromise = null;
    _this._publishPromise = null;
    _this._subscribedStream = null;
    _this._publishedStream = null;
    _this._publication = null;
    _this._subscription = null; // Timer for PeerConnection disconnected. Will stop connection after timer.

    _this._disconnectTimer = null;
    _this._ended = false;
    _this._stopped = false;
    return _this;
  }
  /**
   * @function onMessage
   * @desc Received a message from conference portal. Defined in client-server protocol.
   * @param {string} notification Notification type.
   * @param {object} message Message received.
   * @private
   */


  _createClass(ConferencePeerConnectionChannel, [{
    key: "onMessage",
    value: function onMessage(notification, message) {
      switch (notification) {
        case 'progress':
          if (message.status === 'soac') {
            this._sdpHandler(message.data);
          } else if (message.status === 'ready') {
            this._readyHandler();
          } else if (message.status === 'error') {
            this._errorHandler(message.data);
          }

          break;

        case 'stream':
          this._onStreamEvent(message);

          break;

        default:
          _logger.default.warning('Unknown notification from MCU.');

      }
    }
  }, {
    key: "publish",
    value: function publish(stream, options, videoCodecs) {
      var _this2 = this;

      if (options === undefined) {
        options = {
          audio: !!stream.mediaStream.getAudioTracks().length,
          video: !!stream.mediaStream.getVideoTracks().length
        };
      }

      if (_typeof(options) !== 'object') {
        return Promise.reject(new TypeError('Options should be an object.'));
      }

      if (this._isRtpEncodingParameters(options.audio) && this._isOwtEncodingParameters(options.video) || this._isOwtEncodingParameters(options.audio) && this._isRtpEncodingParameters(options.video)) {
        return Promise.reject(new _error2.ConferenceError('Mixing RTCRtpEncodingParameters and AudioEncodingParameters/VideoEncodingParameters is not allowed.'));
      }

      if (options.audio === undefined) {
        options.audio = !!stream.mediaStream.getAudioTracks().length;
      }

      if (options.video === undefined) {
        options.video = !!stream.mediaStream.getVideoTracks().length;
      }

      if (!!options.audio && !stream.mediaStream.getAudioTracks().length || !!options.video && !stream.mediaStream.getVideoTracks().length) {
        return Promise.reject(new _error2.ConferenceError('options.audio/video is inconsistent with tracks presented in the ' + 'MediaStream.'));
      }

      if ((options.audio === false || options.audio === null) && (options.video === false || options.video === null)) {
        return Promise.reject(new _error2.ConferenceError('Cannot publish a stream without audio and video.'));
      }

      if (_typeof(options.audio) === 'object') {
        if (!Array.isArray(options.audio)) {
          return Promise.reject(new TypeError('options.audio should be a boolean or an array.'));
        }

        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = options.audio[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var parameters = _step.value;

            if (!parameters.codec || typeof parameters.codec.name !== 'string' || parameters.maxBitrate !== undefined && typeof parameters.maxBitrate !== 'number') {
              return Promise.reject(new TypeError('options.audio has incorrect parameters.'));
            }
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }
      }

      if (_typeof(options.video) === 'object' && !Array.isArray(options.video)) {
        return Promise.reject(new TypeError('options.video should be a boolean or an array.'));
      }

      if (this._isOwtEncodingParameters(options.video)) {
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
          for (var _iterator2 = options.video[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var _parameters = _step2.value;

            if (!_parameters.codec || typeof _parameters.codec.name !== 'string' || _parameters.maxBitrate !== undefined && typeof _parameters.maxBitrate !== 'number' || _parameters.codec.profile !== undefined && typeof _parameters.codec.profile !== 'string') {
              return Promise.reject(new TypeError('options.video has incorrect parameters.'));
            }
          }
        } catch (err) {
          _didIteratorError2 = true;
          _iteratorError2 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
              _iterator2.return();
            }
          } finally {
            if (_didIteratorError2) {
              throw _iteratorError2;
            }
          }
        }
      }

      this._options = options;
      var mediaOptions = {};

      this._createPeerConnection();

      if (stream.mediaStream.getAudioTracks().length > 0 && options.audio !== false && options.audio !== null) {
        if (stream.mediaStream.getAudioTracks().length > 1) {
          _logger.default.warning('Publishing a stream with multiple audio tracks is not fully' + ' supported.');
        }

        if (typeof options.audio !== 'boolean' && _typeof(options.audio) !== 'object') {
          return Promise.reject(new _error2.ConferenceError('Type of audio options should be boolean or an object.'));
        }

        mediaOptions.audio = {};
        mediaOptions.audio.source = stream.source.audio;
      } else {
        mediaOptions.audio = false;
      }

      if (stream.mediaStream.getVideoTracks().length > 0 && options.video !== false && options.video !== null) {
        if (stream.mediaStream.getVideoTracks().length > 1) {
          _logger.default.warning('Publishing a stream with multiple video tracks is not fully ' + 'supported.');
        }

        mediaOptions.video = {};
        mediaOptions.video.source = stream.source.video;
        var trackSettings = stream.mediaStream.getVideoTracks()[0].getSettings();
        mediaOptions.video.parameters = {
          resolution: {
            width: trackSettings.width,
            height: trackSettings.height
          },
          framerate: trackSettings.frameRate
        };
      } else {
        mediaOptions.video = false;
      }

      this._publishedStream = stream;

      this._signaling.sendSignalingMessage('publish', {
        media: mediaOptions,
        attributes: stream.attributes
      }).then(function (data) {
        var messageEvent = new _event.MessageEvent('id', {
          message: data.id,
          origin: _this2._remoteId
        });

        _this2.dispatchEvent(messageEvent);

        _this2._internalId = data.id;
        var offerOptions = {};

        if (typeof _this2._pc.addTransceiver === 'function') {
          var setPromise = Promise.resolve(); // |direction| seems not working on Safari.

          if (mediaOptions.audio && stream.mediaStream.getAudioTracks().length > 0) {
            var transceiverInit = {
              direction: 'sendonly'
            };

            if (_this2._isRtpEncodingParameters(options.audio)) {
              transceiverInit.sendEncodings = options.audio;
            }

            var transceiver = _this2._pc.addTransceiver(stream.mediaStream.getAudioTracks()[0], transceiverInit);

            if (Utils.isFirefox()) {
              // Firefox does not support encodings setting in addTransceiver.
              var _parameters2 = transceiver.sender.getParameters();

              _parameters2.encodings = transceiverInit.sendEncodings;
              setPromise = transceiver.sender.setParameters(_parameters2);
            }
          }

          if (mediaOptions.video && stream.mediaStream.getVideoTracks().length > 0) {
            var _transceiverInit = {
              direction: 'sendonly'
            };

            if (_this2._isRtpEncodingParameters(options.video)) {
              _transceiverInit.sendEncodings = options.video;
              _this2._videoCodecs = videoCodecs;
            }

            var _transceiver = _this2._pc.addTransceiver(stream.mediaStream.getVideoTracks()[0], _transceiverInit);

            if (Utils.isFirefox()) {
              // Firefox does not support encodings setting in addTransceiver.
              var _parameters3 = _transceiver.sender.getParameters();

              _parameters3.encodings = _transceiverInit.sendEncodings;
              setPromise = setPromise.then(function () {
                return _transceiver.sender.setParameters(_parameters3);
              });
            }
          }

          return setPromise.then(function () {
            return offerOptions;
          });
        } else {
          if (mediaOptions.audio && stream.mediaStream.getAudioTracks().length > 0) {
            var _iteratorNormalCompletion3 = true;
            var _didIteratorError3 = false;
            var _iteratorError3 = undefined;

            try {
              for (var _iterator3 = stream.mediaStream.getAudioTracks()[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                var track = _step3.value;

                _this2._pc.addTrack(track, stream.mediaStream);
              }
            } catch (err) {
              _didIteratorError3 = true;
              _iteratorError3 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
                  _iterator3.return();
                }
              } finally {
                if (_didIteratorError3) {
                  throw _iteratorError3;
                }
              }
            }
          }

          if (mediaOptions.video && stream.mediaStream.getVideoTracks().length > 0) {
            var _iteratorNormalCompletion4 = true;
            var _didIteratorError4 = false;
            var _iteratorError4 = undefined;

            try {
              for (var _iterator4 = stream.mediaStream.getVideoTracks()[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                var _track = _step4.value;

                _this2._pc.addTrack(_track, stream.mediaStream);
              }
            } catch (err) {
              _didIteratorError4 = true;
              _iteratorError4 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion4 && _iterator4.return != null) {
                  _iterator4.return();
                }
              } finally {
                if (_didIteratorError4) {
                  throw _iteratorError4;
                }
              }
            }
          }

          offerOptions.offerToReceiveAudio = false;
          offerOptions.offerToReceiveVideo = false;
        }

        return offerOptions;
      }).then(function (offerOptions) {
        var localDesc;

        _this2._pc.createOffer(offerOptions).then(function (desc) {
          if (options) {
            desc.sdp = _this2._setRtpReceiverOptions(desc.sdp, options);
          }

          return desc;
        }).then(function (desc) {
          localDesc = desc;
          return _this2._pc.setLocalDescription(desc);
        }).then(function () {
          _this2._signaling.sendSignalingMessage('soac', {
            id: _this2._internalId,
            signaling: localDesc
          });
        }).catch(function (e) {
          _logger.default.error('Failed to create offer or set SDP. Message: ' + e.message);

          _this2._unpublish();

          _this2._rejectPromise(e);

          _this2._fireEndedEventOnPublicationOrSubscription();
        });
      }).catch(function (e) {
        _this2._unpublish();

        _this2._rejectPromise(e);

        _this2._fireEndedEventOnPublicationOrSubscription();
      });

      return new Promise(function (resolve, reject) {
        _this2._publishPromise = {
          resolve: resolve,
          reject: reject
        };
      });
    }
  }, {
    key: "subscribe",
    value: function subscribe(stream, options) {
      var _this3 = this;

      if (options === undefined) {
        options = {
          audio: !!stream.settings.audio,
          video: !!stream.settings.video
        };
      }

      if (_typeof(options) !== 'object') {
        return Promise.reject(new TypeError('Options should be an object.'));
      }

      if (options.audio === undefined) {
        options.audio = !!stream.settings.audio;
      }

      if (options.video === undefined) {
        options.video = !!stream.settings.video;
      }

      if (options.audio !== undefined && _typeof(options.audio) !== 'object' && typeof options.audio !== 'boolean' && options.audio !== null || options.video !== undefined && _typeof(options.video) !== 'object' && typeof options.video !== 'boolean' && options.video !== null) {
        return Promise.reject(new TypeError('Invalid options type.'));
      }

      if (options.audio && !stream.settings.audio || options.video && !stream.settings.video) {
        return Promise.reject(new _error2.ConferenceError('options.audio/video cannot be true or an object if there is no ' + 'audio/video track in remote stream.'));
      }

      if (options.audio === false && options.video === false) {
        return Promise.reject(new _error2.ConferenceError('Cannot subscribe a stream without audio and video.'));
      }

      this._options = options;
      var mediaOptions = {};

      if (options.audio) {
        if (_typeof(options.audio) === 'object' && Array.isArray(options.audio.codecs)) {
          if (options.audio.codecs.length === 0) {
            return Promise.reject(new TypeError('Audio codec cannot be an empty array.'));
          }
        }

        mediaOptions.audio = {};
        mediaOptions.audio.from = stream.id;
      } else {
        mediaOptions.audio = false;
      }

      if (options.video) {
        if (_typeof(options.video) === 'object' && Array.isArray(options.video.codecs)) {
          if (options.video.codecs.length === 0) {
            return Promise.reject(new TypeError('Video codec cannot be an empty array.'));
          }
        }

        mediaOptions.video = {};
        mediaOptions.video.from = stream.id;

        if (options.video.resolution || options.video.frameRate || options.video.bitrateMultiplier && options.video.bitrateMultiplier !== 1 || options.video.keyFrameInterval) {
          mediaOptions.video.parameters = {
            resolution: options.video.resolution,
            framerate: options.video.frameRate,
            bitrate: options.video.bitrateMultiplier ? 'x' + options.video.bitrateMultiplier.toString() : undefined,
            keyFrameInterval: options.video.keyFrameInterval
          };
        }

        if (options.video.rid) {
          mediaOptions.video.simulcastRid = options.video.rid; // Ignore other settings when RID set.

          delete mediaOptions.video.parameters;
          options.video = true;
        }
      } else {
        mediaOptions.video = false;
      }

      this._subscribedStream = stream;

      this._signaling.sendSignalingMessage('subscribe', {
        media: mediaOptions
      }).then(function (data) {
        var messageEvent = new _event.MessageEvent('id', {
          message: data.id,
          origin: _this3._remoteId
        });

        _this3.dispatchEvent(messageEvent);

        _this3._internalId = data.id;

        _this3._createPeerConnection();

        var offerOptions = {};

        if (typeof _this3._pc.addTransceiver === 'function') {
          // |direction| seems not working on Safari.
          if (mediaOptions.audio) {
            _this3._pc.addTransceiver('audio', {
              direction: 'recvonly'
            });
          }

          if (mediaOptions.video) {
            _this3._pc.addTransceiver('video', {
              direction: 'recvonly'
            });
          }
        } else {
          offerOptions.offerToReceiveAudio = !!options.audio;
          offerOptions.offerToReceiveVideo = !!options.video;
        }

        _this3._pc.createOffer(offerOptions).then(function (desc) {
          if (options) {
            desc.sdp = _this3._setRtpReceiverOptions(desc.sdp, options);
          }

          _this3._pc.setLocalDescription(desc).then(function () {
            _this3._signaling.sendSignalingMessage('soac', {
              id: _this3._internalId,
              signaling: desc
            });
          }, function (errorMessage) {
            _logger.default.error('Set local description failed. Message: ' + JSON.stringify(errorMessage));
          });
        }, function (error) {
          _logger.default.error('Create offer failed. Error info: ' + JSON.stringify(error));
        }).catch(function (e) {
          _logger.default.error('Failed to create offer or set SDP. Message: ' + e.message);

          _this3._unsubscribe();

          _this3._rejectPromise(e);

          _this3._fireEndedEventOnPublicationOrSubscription();
        });
      }).catch(function (e) {
        _this3._unsubscribe();

        _this3._rejectPromise(e);

        _this3._fireEndedEventOnPublicationOrSubscription();
      });

      return new Promise(function (resolve, reject) {
        _this3._subscribePromise = {
          resolve: resolve,
          reject: reject
        };
      });
    }
  }, {
    key: "_unpublish",
    value: function _unpublish() {
      if (!this._stopped) {
        this._stopped = true;

        this._signaling.sendSignalingMessage('unpublish', {
          id: this._internalId
        }).catch(function (e) {
          _logger.default.warning('MCU returns negative ack for unpublishing, ' + e);
        });

        if (this._pc && this._pc.signalingState !== 'closed') {
          this._pc.close();
        }
      }
    }
  }, {
    key: "_unsubscribe",
    value: function _unsubscribe() {
      if (!this._stopped) {
        this._stopped = true;

        this._signaling.sendSignalingMessage('unsubscribe', {
          id: this._internalId
        }).catch(function (e) {
          _logger.default.warning('MCU returns negative ack for unsubscribing, ' + e);
        });

        if (this._pc && this._pc.signalingState !== 'closed') {
          this._pc.close();
        }
      }
    }
  }, {
    key: "_muteOrUnmute",
    value: function _muteOrUnmute(isMute, isPub, trackKind) {
      var _this4 = this;

      var eventName = isPub ? 'stream-control' : 'subscription-control';
      var operation = isMute ? 'pause' : 'play';
      return this._signaling.sendSignalingMessage(eventName, {
        id: this._internalId,
        operation: operation,
        data: trackKind
      }).then(function () {
        if (!isPub) {
          var muteEventName = isMute ? 'mute' : 'unmute';

          _this4._subscription.dispatchEvent(new _event.MuteEvent(muteEventName, {
            kind: trackKind
          }));
        }
      });
    }
  }, {
    key: "_applyOptions",
    value: function _applyOptions(options) {
      if (_typeof(options) !== 'object' || _typeof(options.video) !== 'object') {
        return Promise.reject(new _error2.ConferenceError('Options should be an object.'));
      }

      var videoOptions = {};
      videoOptions.resolution = options.video.resolution;
      videoOptions.framerate = options.video.frameRate;
      videoOptions.bitrate = options.video.bitrateMultiplier ? 'x' + options.video.bitrateMultiplier.toString() : undefined;
      videoOptions.keyFrameInterval = options.video.keyFrameInterval;
      return this._signaling.sendSignalingMessage('subscription-control', {
        id: this._internalId,
        operation: 'update',
        data: {
          video: {
            parameters: videoOptions
          }
        }
      }).then();
    }
  }, {
    key: "_onRemoteStreamAdded",
    value: function _onRemoteStreamAdded(event) {
      _logger.default.debug('Remote stream added.');

      if (this._subscribedStream) {
        this._subscribedStream.mediaStream = event.streams[0];
      } else {
        // This is not expected path. However, this is going to happen on Safari
        // because it does not support setting direction of transceiver.
        _logger.default.warning('Received remote stream without subscription.');
      }
    }
  }, {
    key: "_onLocalIceCandidate",
    value: function _onLocalIceCandidate(event) {
      if (event.candidate) {
        if (this._pc.signalingState !== 'stable') {
          this._pendingCandidates.push(event.candidate);
        } else {
          this._sendCandidate(event.candidate);
        }
      } else {
        _logger.default.debug('Empty candidate.');
      }
    }
  }, {
    key: "_fireEndedEventOnPublicationOrSubscription",
    value: function _fireEndedEventOnPublicationOrSubscription() {
      if (this._ended) {
        return;
      }

      this._ended = true;
      var event = new _event.OwtEvent('ended');

      if (this._publication) {
        this._publication.dispatchEvent(event);

        this._publication.stop();
      } else if (this._subscription) {
        this._subscription.dispatchEvent(event);

        this._subscription.stop();
      }
    }
  }, {
    key: "_rejectPromise",
    value: function _rejectPromise(error) {
      if (!error) {
        var _error = new _error2.ConferenceError('Connection failed or closed.');
      } // Rejecting corresponding promise if publishing and subscribing is ongoing.


      if (this._publishPromise) {
        this._publishPromise.reject(error);

        this._publishPromise = undefined;
      } else if (this._subscribePromise) {
        this._subscribePromise.reject(error);

        this._subscribePromise = undefined;
      }
    }
  }, {
    key: "_onIceConnectionStateChange",
    value: function _onIceConnectionStateChange(event) {
      if (!event || !event.currentTarget) {
        return;
      }

      _logger.default.debug('ICE connection state changed to ' + event.currentTarget.iceConnectionState);

      if (event.currentTarget.iceConnectionState === 'closed' || event.currentTarget.iceConnectionState === 'failed') {
        if (event.currentTarget.iceConnectionState === 'failed') {
          this._handleError('connection failed.');
        } else {
          // Fire ended event if publication or subscription exists.
          this._fireEndedEventOnPublicationOrSubscription();
        }
      }
    }
  }, {
    key: "_onConnectionStateChange",
    value: function _onConnectionStateChange(event) {
      if (this._pc.connectionState === 'closed' || this._pc.connectionState === 'failed') {
        if (this._pc.connectionState === 'failed') {
          this._handleError('connection failed.');
        } else {
          // Fire ended event if publication or subscription exists.
          this._fireEndedEventOnPublicationOrSubscription();
        }
      }
    }
  }, {
    key: "_sendCandidate",
    value: function _sendCandidate(candidate) {
      this._signaling.sendSignalingMessage('soac', {
        id: this._internalId,
        signaling: {
          type: 'candidate',
          candidate: {
            candidate: 'a=' + candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex
          }
        }
      });
    }
  }, {
    key: "_createPeerConnection",
    value: function _createPeerConnection() {
      var _this5 = this;

      var pcConfiguration = this._config.rtcConfiguration || {};

      if (Utils.isChrome()) {
        pcConfiguration.sdpSemantics = 'unified-plan';
      }

      this._pc = new RTCPeerConnection(pcConfiguration);

      this._pc.onicecandidate = function (event) {
        _this5._onLocalIceCandidate.apply(_this5, [event]);
      };

      this._pc.ontrack = function (event) {
        _this5._onRemoteStreamAdded.apply(_this5, [event]);
      };

      this._pc.oniceconnectionstatechange = function (event) {
        _this5._onIceConnectionStateChange.apply(_this5, [event]);
      };

      this._pc.onconnectionstatechange = function (event) {
        _this5._onConnectionStateChange.apply(_this5, [event]);
      };
    }
  }, {
    key: "_getStats",
    value: function _getStats() {
      if (this._pc) {
        return this._pc.getStats();
      } else {
        return Promise.reject(new _error2.ConferenceError('PeerConnection is not available.'));
      }
    }
  }, {
    key: "_readyHandler",
    value: function _readyHandler() {
      var _this6 = this;

      if (this._subscribePromise) {
        this._subscription = new _subscription.Subscription(this._internalId, function () {
          _this6._unsubscribe();
        }, function () {
          return _this6._getStats();
        }, function (trackKind) {
          return _this6._muteOrUnmute(true, false, trackKind);
        }, function (trackKind) {
          return _this6._muteOrUnmute(false, false, trackKind);
        }, function (options) {
          return _this6._applyOptions(options);
        }); // Fire subscription's ended event when associated stream is ended.

        this._subscribedStream.addEventListener('ended', function () {
          _this6._subscription.dispatchEvent('ended', new _event.OwtEvent('ended'));
        });

        this._subscribePromise.resolve(this._subscription);
      } else if (this._publishPromise) {
        this._publication = new _publication.Publication(this._internalId, function () {
          _this6._unpublish();

          return Promise.resolve();
        }, function () {
          return _this6._getStats();
        }, function (trackKind) {
          return _this6._muteOrUnmute(true, true, trackKind);
        }, function (trackKind) {
          return _this6._muteOrUnmute(false, true, trackKind);
        });

        this._publishPromise.resolve(this._publication); // Do not fire publication's ended event when associated stream is ended.
        // It may still sending silence or black frames.
        // Refer to https://w3c.github.io/webrtc-pc/#rtcrtpsender-interface.

      }

      this._publishPromise = null;
      this._subscribePromise = null;
    }
  }, {
    key: "_sdpHandler",
    value: function _sdpHandler(sdp) {
      var _this7 = this;

      if (sdp.type === 'answer') {
        if ((this._publication || this._publishPromise) && this._options) {
          sdp.sdp = this._setRtpSenderOptions(sdp.sdp, this._options);
        }

        this._pc.setRemoteDescription(sdp).then(function () {
          if (_this7._pendingCandidates.length > 0) {
            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
              for (var _iterator5 = _this7._pendingCandidates[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                var candidate = _step5.value;

                _this7._sendCandidate(candidate);
              }
            } catch (err) {
              _didIteratorError5 = true;
              _iteratorError5 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion5 && _iterator5.return != null) {
                  _iterator5.return();
                }
              } finally {
                if (_didIteratorError5) {
                  throw _iteratorError5;
                }
              }
            }
          }
        }, function (error) {
          _logger.default.error('Set remote description failed: ' + error);

          _this7._rejectPromise(error);

          _this7._fireEndedEventOnPublicationOrSubscription();
        });
      }
    }
  }, {
    key: "_errorHandler",
    value: function _errorHandler(errorMessage) {
      return this._handleError(errorMessage);
    }
  }, {
    key: "_handleError",
    value: function _handleError(errorMessage) {
      var error = new _error2.ConferenceError(errorMessage);
      var p = this._publishPromise || this._subscribePromise;

      if (p) {
        return this._rejectPromise(error);
      }

      if (this._ended) {
        return;
      }

      var dispatcher = this._publication || this._subscription;

      if (!dispatcher) {
        _logger.default.warning('Neither publication nor subscription is available.');

        return;
      }

      var errorEvent = new _event.ErrorEvent('error', {
        error: error
      });
      dispatcher.dispatchEvent(errorEvent); // Fire ended event when error occured

      this._fireEndedEventOnPublicationOrSubscription();
    }
  }, {
    key: "_setCodecOrder",
    value: function _setCodecOrder(sdp, options) {
      if (this._publication || this._publishPromise) {
        if (options.audio) {
          var audioCodecNames = Array.from(options.audio, function (encodingParameters) {
            return encodingParameters.codec.name;
          });
          sdp = SdpUtils.reorderCodecs(sdp, 'audio', audioCodecNames);
        }

        if (options.video) {
          var videoCodecNames = Array.from(options.video, function (encodingParameters) {
            return encodingParameters.codec.name;
          });
          sdp = SdpUtils.reorderCodecs(sdp, 'video', videoCodecNames);
        }
      } else {
        if (options.audio && options.audio.codecs) {
          var _audioCodecNames = Array.from(options.audio.codecs, function (codec) {
            return codec.name;
          });

          sdp = SdpUtils.reorderCodecs(sdp, 'audio', _audioCodecNames);
        }

        if (options.video && options.video.codecs) {
          var _videoCodecNames = Array.from(options.video.codecs, function (codec) {
            return codec.name;
          });

          sdp = SdpUtils.reorderCodecs(sdp, 'video', _videoCodecNames);
        }
      }

      return sdp;
    }
  }, {
    key: "_setMaxBitrate",
    value: function _setMaxBitrate(sdp, options) {
      if (_typeof(options.audio) === 'object') {
        sdp = SdpUtils.setMaxBitrate(sdp, options.audio);
      }

      if (_typeof(options.video) === 'object') {
        sdp = SdpUtils.setMaxBitrate(sdp, options.video);
      }

      return sdp;
    }
  }, {
    key: "_setRtpSenderOptions",
    value: function _setRtpSenderOptions(sdp, options) {
      // SDP mugling is deprecated, moving to `setParameters`.
      if (this._isRtpEncodingParameters(options.audio) || this._isRtpEncodingParameters(options.video)) {
        return sdp;
      }

      sdp = this._setMaxBitrate(sdp, options);
      return sdp;
    }
  }, {
    key: "_setRtpReceiverOptions",
    value: function _setRtpReceiverOptions(sdp, options) {
      // Add legacy simulcast in SDP for safari.
      if (this._isRtpEncodingParameters(options.video) && Utils.isSafari()) {
        if (options.video.length > 1) {
          sdp = SdpUtils.addLegacySimulcast(sdp, 'video', options.video.length);
        }
      } // _videoCodecs is a workaround for setting video codecs. It will be moved to RTCRtpSendParameters.


      if (this._isRtpEncodingParameters(options.video) && this._videoCodecs) {
        sdp = SdpUtils.reorderCodecs(sdp, 'video', this._videoCodecs);
        return sdp;
      }

      if (this._isRtpEncodingParameters(options.audio) || this._isRtpEncodingParameters(options.video)) {
        return sdp;
      }

      sdp = this._setCodecOrder(sdp, options);
      return sdp;
    } // Handle stream event sent from MCU. Some stream events should be publication
    // event or subscription event. It will be handled here.

  }, {
    key: "_onStreamEvent",
    value: function _onStreamEvent(message) {
      var eventTarget;

      if (this._publication && message.id === this._publication.id) {
        eventTarget = this._publication;
      } else if (this._subscribedStream && message.id === this._subscribedStream.id) {
        eventTarget = this._subscription;
      }

      if (!eventTarget) {
        return;
      }

      var trackKind;

      if (message.data.field === 'audio.status') {
        trackKind = _mediaformat.TrackKind.AUDIO;
      } else if (message.data.field === 'video.status') {
        trackKind = _mediaformat.TrackKind.VIDEO;
      } else {
        _logger.default.warning('Invalid data field for stream update info.');
      }

      if (message.data.value === 'active') {
        eventTarget.dispatchEvent(new _event.MuteEvent('unmute', {
          kind: trackKind
        }));
      } else if (message.data.value === 'inactive') {
        eventTarget.dispatchEvent(new _event.MuteEvent('mute', {
          kind: trackKind
        }));
      } else {
        _logger.default.warning('Invalid data value for stream update info.');
      }
    }
  }, {
    key: "_isRtpEncodingParameters",
    value: function _isRtpEncodingParameters(obj) {
      if (!Array.isArray(obj)) {
        return false;
      } // Only check the first one.


      var param = obj[0];
      return param.codecPayloadType || param.dtx || param.active || param.ptime || param.maxFramerate || param.scaleResolutionDownBy || param.rid;
    }
  }, {
    key: "_isOwtEncodingParameters",
    value: function _isOwtEncodingParameters(obj) {
      if (!Array.isArray(obj)) {
        return false;
      } // Only check the first one.


      var param = obj[0];
      return !!param.codec;
    }
  }]);

  return ConferencePeerConnectionChannel;
}(_event.EventDispatcher);

exports.ConferencePeerConnectionChannel = ConferencePeerConnectionChannel;

},{"../base/event.js":3,"../base/logger.js":5,"../base/mediaformat.js":6,"../base/publication.js":8,"../base/sdputils.js":9,"../base/utils.js":11,"./error.js":14,"./subscription.js":21}],13:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* global Map, Promise */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ConferenceClient = void 0;

var EventModule = _interopRequireWildcard(require("../base/event.js"));

var _signaling = require("./signaling.js");

var _logger = _interopRequireDefault(require("../base/logger.js"));

var _base = require("../base/base64.js");

var _error = require("./error.js");

var Utils = _interopRequireWildcard(require("../base/utils.js"));

var StreamModule = _interopRequireWildcard(require("../base/stream.js"));

var _participant2 = require("./participant.js");

var _info = require("./info.js");

var _channel = require("./channel.js");

var _mixedstream = require("./mixedstream.js");

var StreamUtilsModule = _interopRequireWildcard(require("./streamutils.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var SignalingState = {
  READY: 1,
  CONNECTING: 2,
  CONNECTED: 3
};
var protocolVersion = '1.1';
/* eslint-disable valid-jsdoc */

/**
 * @class ParticipantEvent
 * @classDesc Class ParticipantEvent represents a participant event.
   @extends Owt.Base.OwtEvent
 * @memberof Owt.Conference
 * @hideconstructor
 */

var ParticipantEvent = function ParticipantEvent(type, init) {
  var that = new EventModule.OwtEvent(type, init);
  /**
   * @member {Owt.Conference.Participant} participant
   * @instance
   * @memberof Owt.Conference.ParticipantEvent
   */

  that.participant = init.participant;
  return that;
};
/* eslint-enable valid-jsdoc */

/**
 * @class ConferenceClientConfiguration
 * @classDesc Configuration for ConferenceClient.
 * @memberOf Owt.Conference
 * @hideconstructor
 */


var ConferenceClientConfiguration = // eslint-disable-line no-unused-vars
// eslint-disable-next-line require-jsdoc
function ConferenceClientConfiguration() {
  _classCallCheck(this, ConferenceClientConfiguration);

  /**
   * @member {?RTCConfiguration} rtcConfiguration
   * @instance
   * @memberof Owt.Conference.ConferenceClientConfiguration
   * @desc It will be used for creating PeerConnection.
   * @see {@link https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary|RTCConfiguration Dictionary of WebRTC 1.0}.
   * @example
   * // Following object can be set to conferenceClientConfiguration.rtcConfiguration.
   * {
   *   iceServers: [{
   *      urls: "stun:example.com:3478"
   *   }, {
   *     urls: [
   *       "turn:example.com:3478?transport=udp",
   *       "turn:example.com:3478?transport=tcp"
   *     ],
   *      credential: "password",
   *      username: "username"
   *   }
   * }
   */
  this.rtcConfiguration = undefined;
};
/**
 * @class ConferenceClient
 * @classdesc The ConferenceClient handles PeerConnections between client and server. For conference controlling, please refer to REST API guide.
 * Events:
 *
 * | Event Name            | Argument Type                    | Fired when       |
 * | --------------------- | ---------------------------------| ---------------- |
 * | streamadded           | Owt.Base.StreamEvent             | A new stream is available in the conference. |
 * | participantjoined     | Owt.Conference.ParticipantEvent  | A new participant joined the conference. |
 * | messagereceived       | Owt.Base.MessageEvent            | A new message is received. |
 * | serverdisconnected    | Owt.Base.OwtEvent                | Disconnected from conference server. |
 *
 * @memberof Owt.Conference
 * @extends Owt.Base.EventDispatcher
 * @constructor
 * @param {?Owt.Conference.ConferenceClientConfiguration } config Configuration for ConferenceClient.
 * @param {?Owt.Conference.SioSignaling } signalingImpl Signaling channel implementation for ConferenceClient. SDK uses default signaling channel implementation if this parameter is undefined. Currently, a Socket.IO signaling channel implementation was provided as ics.conference.SioSignaling. However, it is not recommended to directly access signaling channel or customize signaling channel for ConferenceClient as this time.
 */


var ConferenceClient = function ConferenceClient(config, signalingImpl) {
  Object.setPrototypeOf(this, new EventModule.EventDispatcher());
  config = config || {};
  var self = this;
  var signalingState = SignalingState.READY;
  var signaling = signalingImpl ? signalingImpl : new _signaling.SioSignaling();
  var me;
  var room;
  var remoteStreams = new Map(); // Key is stream ID, value is a RemoteStream.

  var participants = new Map(); // Key is participant ID, value is a Participant object.

  var publishChannels = new Map(); // Key is MediaStream's ID, value is pc channel.

  var channels = new Map(); // Key is channel's internal ID, value is channel.

  /**
   * @function onSignalingMessage
   * @desc Received a message from conference portal. Defined in client-server protocol.
   * @param {string} notification Notification type.
   * @param {object} data Data received.
   * @private
   */

  function onSignalingMessage(notification, data) {
    if (notification === 'soac' || notification === 'progress') {
      if (!channels.has(data.id)) {
        _logger.default.warning('Cannot find a channel for incoming data.');

        return;
      }

      channels.get(data.id).onMessage(notification, data);
    } else if (notification === 'stream') {
      if (data.status === 'add') {
        fireStreamAdded(data.data);
      } else if (data.status === 'remove') {
        fireStreamRemoved(data);
      } else if (data.status === 'update') {
        // Broadcast audio/video update status to channel so specific events can be fired on publication or subscription.
        if (data.data.field === 'audio.status' || data.data.field === 'video.status') {
          channels.forEach(function (c) {
            c.onMessage(notification, data);
          });
        } else if (data.data.field === 'activeInput') {
          fireActiveAudioInputChange(data);
        } else if (data.data.field === 'video.layout') {
          fireLayoutChange(data);
        } else if (data.data.field === '.') {
          updateRemoteStream(data.data.value);
        } else {
          _logger.default.warning('Unknown stream event from MCU.');
        }
      }
    } else if (notification === 'text') {
      fireMessageReceived(data);
    } else if (notification === 'participant') {
      fireParticipantEvent(data);
    }
  }

  signaling.addEventListener('data', function (event) {
    onSignalingMessage(event.message.notification, event.message.data);
  });
  signaling.addEventListener('disconnect', function () {
    clean();
    signalingState = SignalingState.READY;
    self.dispatchEvent(new EventModule.OwtEvent('serverdisconnected'));
  }); // eslint-disable-next-line require-jsdoc

  function fireParticipantEvent(data) {
    if (data.action === 'join') {
      data = data.data;
      var participant = new _participant2.Participant(data.id, data.role, data.user);
      participants.set(data.id, participant);
      var event = new ParticipantEvent('participantjoined', {
        participant: participant
      });
      self.dispatchEvent(event);
    } else if (data.action === 'leave') {
      var participantId = data.data;

      if (!participants.has(participantId)) {
        _logger.default.warning('Received leave message from MCU for an unknown participant.');

        return;
      }

      var _participant = participants.get(participantId);

      participants.delete(participantId);

      _participant.dispatchEvent(new EventModule.OwtEvent('left'));
    }
  } // eslint-disable-next-line require-jsdoc


  function fireMessageReceived(data) {
    var messageEvent = new EventModule.MessageEvent('messagereceived', {
      message: data.message,
      origin: data.from,
      to: data.to
    });
    self.dispatchEvent(messageEvent);
  } // eslint-disable-next-line require-jsdoc


  function fireStreamAdded(info) {
    var stream = createRemoteStream(info);
    remoteStreams.set(stream.id, stream);
    var streamEvent = new StreamModule.StreamEvent('streamadded', {
      stream: stream
    });
    self.dispatchEvent(streamEvent);
  } // eslint-disable-next-line require-jsdoc


  function fireStreamRemoved(info) {
    if (!remoteStreams.has(info.id)) {
      _logger.default.warning('Cannot find specific remote stream.');

      return;
    }

    var stream = remoteStreams.get(info.id);
    var streamEvent = new EventModule.OwtEvent('ended');
    remoteStreams.delete(stream.id);
    stream.dispatchEvent(streamEvent);
  } // eslint-disable-next-line require-jsdoc


  function fireActiveAudioInputChange(info) {
    if (!remoteStreams.has(info.id)) {
      _logger.default.warning('Cannot find specific remote stream.');

      return;
    }

    var stream = remoteStreams.get(info.id);
    var streamEvent = new _mixedstream.ActiveAudioInputChangeEvent('activeaudioinputchange', {
      activeAudioInputStreamId: info.data.value
    });
    stream.dispatchEvent(streamEvent);
  } // eslint-disable-next-line require-jsdoc


  function fireLayoutChange(info) {
    if (!remoteStreams.has(info.id)) {
      _logger.default.warning('Cannot find specific remote stream.');

      return;
    }

    var stream = remoteStreams.get(info.id);
    var streamEvent = new _mixedstream.LayoutChangeEvent('layoutchange', {
      layout: info.data.value
    });
    stream.dispatchEvent(streamEvent);
  } // eslint-disable-next-line require-jsdoc


  function updateRemoteStream(streamInfo) {
    if (!remoteStreams.has(streamInfo.id)) {
      _logger.default.warning('Cannot find specific remote stream.');

      return;
    }

    var stream = remoteStreams.get(streamInfo.id);
    stream.settings = StreamUtilsModule.convertToPublicationSettings(streamInfo.media);
    stream.extraCapabilities = StreamUtilsModule.convertToSubscriptionCapabilities(streamInfo.media);
    var streamEvent = new EventModule.OwtEvent('updated');
    stream.dispatchEvent(streamEvent);
  } // eslint-disable-next-line require-jsdoc


  function createRemoteStream(streamInfo) {
    if (streamInfo.type === 'mixed') {
      return new _mixedstream.RemoteMixedStream(streamInfo);
    } else {
      var audioSourceInfo;
      var videoSourceInfo;

      if (streamInfo.media.audio) {
        audioSourceInfo = streamInfo.media.audio.source;
      }

      if (streamInfo.media.video) {
        videoSourceInfo = streamInfo.media.video.source;
      }

      var stream = new StreamModule.RemoteStream(streamInfo.id, streamInfo.info.owner, undefined, new StreamModule.StreamSourceInfo(audioSourceInfo, videoSourceInfo), streamInfo.info.attributes);
      stream.settings = StreamUtilsModule.convertToPublicationSettings(streamInfo.media);
      stream.extraCapabilities = StreamUtilsModule.convertToSubscriptionCapabilities(streamInfo.media);
      return stream;
    }
  } // eslint-disable-next-line require-jsdoc


  function sendSignalingMessage(type, message) {
    return signaling.send(type, message);
  } // eslint-disable-next-line require-jsdoc


  function createPeerConnectionChannel() {
    // Construct an signaling sender/receiver for ConferencePeerConnection.
    var signalingForChannel = Object.create(EventModule.EventDispatcher);
    signalingForChannel.sendSignalingMessage = sendSignalingMessage;
    var pcc = new _channel.ConferencePeerConnectionChannel(config, signalingForChannel);
    pcc.addEventListener('id', function (messageEvent) {
      channels.set(messageEvent.message, pcc);
    });
    return pcc;
  } // eslint-disable-next-line require-jsdoc


  function clean() {
    participants.clear();
    remoteStreams.clear();
  }

  Object.defineProperty(this, 'info', {
    configurable: false,
    get: function get() {
      if (!room) {
        return null;
      }

      return new _info.ConferenceInfo(room.id, Array.from(participants, function (x) {
        return x[1];
      }), Array.from(remoteStreams, function (x) {
        return x[1];
      }), me);
    }
  });
  /**
   * @function join
   * @instance
   * @desc Join a conference.
   * @memberof Owt.Conference.ConferenceClient
   * @returns {Promise<ConferenceInfo, Error>} Return a promise resolved with current conference's information if successfully join the conference. Or return a promise rejected with a newly created Owt.Error if failed to join the conference.
   * @param {string} tokenString Token is issued by conference server(nuve).
   */

  this.join = function (tokenString) {
    return new Promise(function (resolve, reject) {
      var token = JSON.parse(_base.Base64.decodeBase64(tokenString));
      var isSecured = token.secure === true;
      var host = token.host;

      if (typeof host !== 'string') {
        reject(new _error.ConferenceError('Invalid host.'));
        return;
      }

      if (host.indexOf('http') === -1) {
        host = isSecured ? 'https://' + host : 'http://' + host;
      }

      if (signalingState !== SignalingState.READY) {
        reject(new _error.ConferenceError('connection state invalid'));
        return;
      }

      signalingState = SignalingState.CONNECTING;
      var loginInfo = {
        token: tokenString,
        userAgent: Utils.sysInfo(),
        protocol: protocolVersion
      };
      signaling.connect(host, isSecured, loginInfo).then(function (resp) {
        signalingState = SignalingState.CONNECTED;
        room = resp.room;

        if (room.streams !== undefined) {
          var _iteratorNormalCompletion = true;
          var _didIteratorError = false;
          var _iteratorError = undefined;

          try {
            for (var _iterator = room.streams[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
              var st = _step.value;

              if (st.type === 'mixed') {
                st.viewport = st.info.label;
              }

              remoteStreams.set(st.id, createRemoteStream(st));
            }
          } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
              }
            } finally {
              if (_didIteratorError) {
                throw _iteratorError;
              }
            }
          }
        }

        if (resp.room && resp.room.participants !== undefined) {
          var _iteratorNormalCompletion2 = true;
          var _didIteratorError2 = false;
          var _iteratorError2 = undefined;

          try {
            for (var _iterator2 = resp.room.participants[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
              var p = _step2.value;
              participants.set(p.id, new _participant2.Participant(p.id, p.role, p.user));

              if (p.id === resp.id) {
                me = participants.get(p.id);
              }
            }
          } catch (err) {
            _didIteratorError2 = true;
            _iteratorError2 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
                _iterator2.return();
              }
            } finally {
              if (_didIteratorError2) {
                throw _iteratorError2;
              }
            }
          }
        }

        resolve(new _info.ConferenceInfo(resp.room.id, Array.from(participants.values()), Array.from(remoteStreams.values()), me));
      }, function (e) {
        signalingState = SignalingState.READY;
        reject(new _error.ConferenceError(e));
      });
    });
  };
  /**
   * @function publish
   * @memberof Owt.Conference.ConferenceClient
   * @instance
   * @desc Publish a LocalStream to conference server. Other participants will be able to subscribe this stream when it is successfully published.
   * @param {Owt.Base.LocalStream} stream The stream to be published.
   * @param {Owt.Base.PublishOptions} options Options for publication.
   * @param {string[]} videoCodecs Video codec names for publishing. Valid values are 'VP8', 'VP9' and 'H264'. This parameter only valid when options.video is RTCRtpEncodingParameters. Publishing with RTCRtpEncodingParameters is an experimental feature. This parameter is subject to change.
   * @returns {Promise<Publication, Error>} Returned promise will be resolved with a newly created Publication once specific stream is successfully published, or rejected with a newly created Error if stream is invalid or options cannot be satisfied. Successfully published means PeerConnection is established and server is able to process media data.
   */


  this.publish = function (stream, options, videoCodecs) {
    if (!(stream instanceof StreamModule.LocalStream)) {
      return Promise.reject(new _error.ConferenceError('Invalid stream.'));
    }

    if (publishChannels.has(stream.mediaStream.id)) {
      return Promise.reject(new _error.ConferenceError('Cannot publish a published stream.'));
    }

    var channel = createPeerConnectionChannel();
    return channel.publish(stream, options, videoCodecs);
  };
  /**
   * @function subscribe
   * @memberof Owt.Conference.ConferenceClient
   * @instance
   * @desc Subscribe a RemoteStream from conference server.
   * @param {Owt.Base.RemoteStream} stream The stream to be subscribed.
   * @param {Owt.Conference.SubscribeOptions} options Options for subscription.
   * @returns {Promise<Subscription, Error>} Returned promise will be resolved with a newly created Subscription once specific stream is successfully subscribed, or rejected with a newly created Error if stream is invalid or options cannot be satisfied. Successfully subscribed means PeerConnection is established and server was started to send media data.
   */


  this.subscribe = function (stream, options) {
    if (!(stream instanceof StreamModule.RemoteStream)) {
      return Promise.reject(new _error.ConferenceError('Invalid stream.'));
    }

    var channel = createPeerConnectionChannel();
    return channel.subscribe(stream, options);
  };
  /**
   * @function send
   * @memberof Owt.Conference.ConferenceClient
   * @instance
   * @desc Send a text message to a participant or all participants.
   * @param {string} message Message to be sent.
   * @param {string} participantId Receiver of this message. Message will be sent to all participants if participantId is undefined.
   * @return {Promise<void, Error>} Returned promise will be resolved when conference server received certain message.
   */


  this.send = function (message, participantId) {
    if (participantId === undefined) {
      participantId = 'all';
    }

    return sendSignalingMessage('text', {
      to: participantId,
      message: message
    });
  };
  /**
   * @function leave
   * @memberOf Owt.Conference.ConferenceClient
   * @instance
   * @desc Leave a conference.
   * @return {Promise<void, Error>} Returned promise will be resolved with undefined once the connection is disconnected.
   */


  this.leave = function () {
    return signaling.disconnect().then(function () {
      clean();
      signalingState = SignalingState.READY;
    });
  };
};

exports.ConferenceClient = ConferenceClient;

},{"../base/base64.js":1,"../base/event.js":3,"../base/logger.js":5,"../base/stream.js":10,"../base/utils.js":11,"./channel.js":12,"./error.js":14,"./info.js":16,"./mixedstream.js":17,"./participant.js":18,"./signaling.js":19,"./streamutils.js":20}],14:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';
/**
 * @class ConferenceError
 * @classDesc The ConferenceError object represents an error in conference mode.
 * @memberOf Owt.Conference
 * @hideconstructor
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ConferenceError = void 0;

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _wrapNativeSuper(Class) { var _cache = typeof Map === "function" ? new Map() : undefined; _wrapNativeSuper = function _wrapNativeSuper(Class) { if (Class === null || !_isNativeFunction(Class)) return Class; if (typeof Class !== "function") { throw new TypeError("Super expression must either be null or a function"); } if (typeof _cache !== "undefined") { if (_cache.has(Class)) return _cache.get(Class); _cache.set(Class, Wrapper); } function Wrapper() { return _construct(Class, arguments, _getPrototypeOf(this).constructor); } Wrapper.prototype = Object.create(Class.prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } }); return _setPrototypeOf(Wrapper, Class); }; return _wrapNativeSuper(Class); }

function isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

function _construct(Parent, args, Class) { if (isNativeReflectConstruct()) { _construct = Reflect.construct; } else { _construct = function _construct(Parent, args, Class) { var a = [null]; a.push.apply(a, args); var Constructor = Function.bind.apply(Parent, a); var instance = new Constructor(); if (Class) _setPrototypeOf(instance, Class.prototype); return instance; }; } return _construct.apply(null, arguments); }

function _isNativeFunction(fn) { return Function.toString.call(fn).indexOf("[native code]") !== -1; }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

var ConferenceError =
/*#__PURE__*/
function (_Error) {
  _inherits(ConferenceError, _Error);

  // eslint-disable-next-line require-jsdoc
  function ConferenceError(message) {
    _classCallCheck(this, ConferenceError);

    return _possibleConstructorReturn(this, _getPrototypeOf(ConferenceError).call(this, message));
  }

  return ConferenceError;
}(_wrapNativeSuper(Error));

exports.ConferenceError = ConferenceError;

},{}],15:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "ConferenceClient", {
  enumerable: true,
  get: function get() {
    return _client.ConferenceClient;
  }
});
Object.defineProperty(exports, "SioSignaling", {
  enumerable: true,
  get: function get() {
    return _signaling.SioSignaling;
  }
});

var _client = require("./client.js");

var _signaling = require("./signaling.js");

},{"./client.js":13,"./signaling.js":19}],16:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';
/**
 * @class ConferenceInfo
 * @classDesc Information for a conference.
 * @memberOf Owt.Conference
 * @hideconstructor
 */

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ConferenceInfo = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var ConferenceInfo = // eslint-disable-next-line require-jsdoc
function ConferenceInfo(id, participants, remoteStreams, myInfo) {
  _classCallCheck(this, ConferenceInfo);

  /**
   * @member {string} id
   * @instance
   * @memberof Owt.Conference.ConferenceInfo
   * @desc Conference ID.
   */
  this.id = id;
  /**
   * @member {Array<Owt.Conference.Participant>} participants
   * @instance
   * @memberof Owt.Conference.ConferenceInfo
   * @desc Participants in the conference.
   */

  this.participants = participants;
  /**
   * @member {Array<Owt.Base.RemoteStream>} remoteStreams
   * @instance
   * @memberof Owt.Conference.ConferenceInfo
   * @desc Streams published by participants. It also includes streams published by current user.
   */

  this.remoteStreams = remoteStreams;
  /**
   * @member {Owt.Base.Participant} self
   * @instance
   * @memberof Owt.Conference.ConferenceInfo
   */

  this.self = myInfo;
};

exports.ConferenceInfo = ConferenceInfo;

},{}],17:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LayoutChangeEvent = exports.ActiveAudioInputChangeEvent = exports.RemoteMixedStream = void 0;

var StreamModule = _interopRequireWildcard(require("../base/stream.js"));

var StreamUtilsModule = _interopRequireWildcard(require("./streamutils.js"));

var _event = require("../base/event.js");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

/**
 * @class RemoteMixedStream
 * @classDesc Mixed stream from conference server.
 * Events:
 *
 * | Event Name             | Argument Type    | Fired when       |
 * | -----------------------| ---------------- | ---------------- |
 * | activeaudioinputchange | Event            | Audio activeness of input stream (of the mixed stream) is changed. |
 * | layoutchange           | Event            | Video's layout has been changed. It usually happens when a new video is mixed into the target mixed stream or an existing video has been removed from mixed stream. |
 *
 * @memberOf Owt.Conference
 * @extends Owt.Base.RemoteStream
 * @hideconstructor
 */
var RemoteMixedStream =
/*#__PURE__*/
function (_StreamModule$RemoteS) {
  _inherits(RemoteMixedStream, _StreamModule$RemoteS);

  // eslint-disable-next-line require-jsdoc
  function RemoteMixedStream(info) {
    var _this;

    _classCallCheck(this, RemoteMixedStream);

    if (info.type !== 'mixed') {
      throw new TypeError('Not a mixed stream');
    }

    _this = _possibleConstructorReturn(this, _getPrototypeOf(RemoteMixedStream).call(this, info.id, undefined, undefined, new StreamModule.StreamSourceInfo('mixed', 'mixed')));
    _this.settings = StreamUtilsModule.convertToPublicationSettings(info.media);
    _this.extraCapabilities = new StreamUtilsModule.convertToSubscriptionCapabilities(info.media);
    return _this;
  }

  return RemoteMixedStream;
}(StreamModule.RemoteStream);
/**
 * @class ActiveAudioInputChangeEvent
 * @classDesc Class ActiveAudioInputChangeEvent represents an active audio input change event.
 * @memberof Owt.Conference
 * @hideconstructor
 */


exports.RemoteMixedStream = RemoteMixedStream;

var ActiveAudioInputChangeEvent =
/*#__PURE__*/
function (_OwtEvent) {
  _inherits(ActiveAudioInputChangeEvent, _OwtEvent);

  // eslint-disable-next-line require-jsdoc
  function ActiveAudioInputChangeEvent(type, init) {
    var _this2;

    _classCallCheck(this, ActiveAudioInputChangeEvent);

    _this2 = _possibleConstructorReturn(this, _getPrototypeOf(ActiveAudioInputChangeEvent).call(this, type));
    /**
     * @member {string} activeAudioInputStreamId
     * @instance
     * @memberof Owt.Conference.ActiveAudioInputChangeEvent
     * @desc The ID of input stream(of the mixed stream) whose audio is active.
     */

    _this2.activeAudioInputStreamId = init.activeAudioInputStreamId;
    return _this2;
  }

  return ActiveAudioInputChangeEvent;
}(_event.OwtEvent);
/**
 * @class LayoutChangeEvent
 * @classDesc Class LayoutChangeEvent represents an video layout change event.
 * @memberof Owt.Conference
 * @hideconstructor
 */


exports.ActiveAudioInputChangeEvent = ActiveAudioInputChangeEvent;

var LayoutChangeEvent =
/*#__PURE__*/
function (_OwtEvent2) {
  _inherits(LayoutChangeEvent, _OwtEvent2);

  // eslint-disable-next-line require-jsdoc
  function LayoutChangeEvent(type, init) {
    var _this3;

    _classCallCheck(this, LayoutChangeEvent);

    _this3 = _possibleConstructorReturn(this, _getPrototypeOf(LayoutChangeEvent).call(this, type));
    /**
     * @member {object} layout
     * @instance
     * @memberof Owt.Conference.LayoutChangeEvent
     * @desc Current video's layout. It's an array of map which maps each stream to a region.
     */

    _this3.layout = init.layout;
    return _this3;
  }

  return LayoutChangeEvent;
}(_event.OwtEvent);

exports.LayoutChangeEvent = LayoutChangeEvent;

},{"../base/event.js":3,"../base/stream.js":10,"./streamutils.js":20}],18:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Participant = void 0;

var EventModule = _interopRequireWildcard(require("../base/event.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

'use strict';
/**
 * @class Participant
 * @memberOf Owt.Conference
 * @classDesc The Participant defines a participant in a conference.
 * Events:
 *
 * | Event Name      | Argument Type      | Fired when       |
 * | ----------------| ------------------ | ---------------- |
 * | left            | Owt.Base.OwtEvent  | The participant left the conference. |
 *
 * @extends Owt.Base.EventDispatcher
 * @hideconstructor
 */


var Participant =
/*#__PURE__*/
function (_EventModule$EventDis) {
  _inherits(Participant, _EventModule$EventDis);

  // eslint-disable-next-line require-jsdoc
  function Participant(id, role, userId) {
    var _this;

    _classCallCheck(this, Participant);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(Participant).call(this));
    /**
     * @member {string} id
     * @instance
     * @memberof Owt.Conference.Participant
     * @desc The ID of the participant. It varies when a single user join different conferences.
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'id', {
      configurable: false,
      writable: false,
      value: id
    });
    /**
     * @member {string} role
     * @instance
     * @memberof Owt.Conference.Participant
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'role', {
      configurable: false,
      writable: false,
      value: role
    });
    /**
     * @member {string} userId
     * @instance
     * @memberof Owt.Conference.Participant
     * @desc The user ID of the participant. It can be integrated into existing account management system.
     */

    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'userId', {
      configurable: false,
      writable: false,
      value: userId
    });
    return _this;
  }

  return Participant;
}(EventModule.EventDispatcher);

exports.Participant = Participant;

},{"../base/event.js":3}],19:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SioSignaling = void 0;

var _logger = _interopRequireDefault(require("../base/logger.js"));

var EventModule = _interopRequireWildcard(require("../base/event.js"));

var _error = require("./error.js");

var _base = require("../base/base64.js");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

'use strict';

var reconnectionAttempts = 10; // eslint-disable-next-line require-jsdoc

function handleResponse(status, data, resolve, reject) {
  if (status === 'ok' || status === 'success') {
    resolve(data);
  } else if (status === 'error') {
    reject(data);
  } else {
    _logger.default.error('MCU returns unknown ack.');
  }
}
/**
 * @class SioSignaling
 * @classdesc Socket.IO signaling channel for ConferenceClient. It is not recommended to directly access this class.
 * @memberof Owt.Conference
 * @extends Owt.Base.EventDispatcher
 * @constructor
 */


var SioSignaling =
/*#__PURE__*/
function (_EventModule$EventDis) {
  _inherits(SioSignaling, _EventModule$EventDis);

  // eslint-disable-next-line require-jsdoc
  function SioSignaling() {
    var _this;

    _classCallCheck(this, SioSignaling);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(SioSignaling).call(this));
    _this._socket = null;
    _this._loggedIn = false;
    _this._reconnectTimes = 0;
    _this._reconnectionTicket = null;
    _this._refreshReconnectionTicket = null;
    return _this;
  }
  /**
   * @function connect
   * @instance
   * @desc Connect to a portal.
   * @memberof Oms.Conference.SioSignaling
   * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal if successfully logged in. Or return a promise rejected with a newly created Oms.Error if failed.
   * @param {string} host Host of the portal.
   * @param {string} isSecured Is secure connection or not.
   * @param {string} loginInfo Infomation required for logging in.
   * @private.
   */


  _createClass(SioSignaling, [{
    key: "connect",
    value: function connect(host, isSecured, loginInfo) {
      var _this2 = this;

      return new Promise(function (resolve, reject) {
        var opts = {
          'reconnection': true,
          'reconnectionAttempts': reconnectionAttempts,
          'force new connection': true
        };
        _this2._socket = io(host, opts);
        ['participant', 'text', 'stream', 'progress'].forEach(function (notification) {
          _this2._socket.on(notification, function (data) {
            _this2.dispatchEvent(new EventModule.MessageEvent('data', {
              message: {
                notification: notification,
                data: data
              }
            }));
          });
        });

        _this2._socket.on('reconnecting', function () {
          _this2._reconnectTimes++;
        });

        _this2._socket.on('reconnect_failed', function () {
          if (_this2._reconnectTimes >= reconnectionAttempts) {
            _this2.dispatchEvent(new EventModule.OwtEvent('disconnect'));
          }
        });

        _this2._socket.on('connect_error', function (e) {
          reject("connect_error:".concat(host));
        });

        _this2._socket.on('drop', function () {
          _this2._reconnectTimes = reconnectionAttempts;
        });

        _this2._socket.on('disconnect', function () {
          _this2._clearReconnectionTask();

          if (_this2._reconnectTimes >= reconnectionAttempts) {
            _this2._loggedIn = false;

            _this2.dispatchEvent(new EventModule.OwtEvent('disconnect'));
          }
        });

        _this2._socket.emit('login', loginInfo, function (status, data) {
          if (status === 'ok') {
            _this2._loggedIn = true;

            _this2._onReconnectionTicket(data.reconnectionTicket);

            _this2._socket.on('connect', function () {
              // re-login with reconnection ticket.
              _this2._socket.emit('relogin', _this2._reconnectionTicket, function (status, data) {
                if (status === 'ok') {
                  _this2._reconnectTimes = 0;

                  _this2._onReconnectionTicket(data);
                } else {
                  _this2.dispatchEvent(new EventModule.OwtEvent('disconnect'));
                }
              });
            });
          }

          handleResponse(status, data, resolve, reject);
        });
      });
    }
    /**
     * @function disconnect
     * @instance
     * @desc Disconnect from a portal.
     * @memberof Oms.Conference.SioSignaling
     * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal if successfully disconnected. Or return a promise rejected with a newly created Oms.Error if failed.
     * @private.
     */

  }, {
    key: "disconnect",
    value: function disconnect() {
      var _this3 = this;

      if (!this._socket || this._socket.disconnected) {
        return Promise.reject(new _error.ConferenceError('Portal is not connected.'));
      }

      return new Promise(function (resolve, reject) {
        _this3._socket.emit('logout', function (status, data) {
          // Maximize the reconnect times to disable reconnection.
          _this3._reconnectTimes = reconnectionAttempts;

          _this3._socket.disconnect();

          handleResponse(status, data, resolve, reject);
        });
      });
    }
    /**
     * @function send
     * @instance
     * @desc Send data to portal.
     * @memberof Oms.Conference.SioSignaling
     * @return {Promise<Object, Error>} Return a promise resolved with the data returned by portal. Or return a promise rejected with a newly created Oms.Error if failed to send the message.
     * @param {string} requestName Name defined in client-server protocol.
     * @param {string} requestData Data format is defined in client-server protocol.
     * @private.
     */

  }, {
    key: "send",
    value: function send(requestName, requestData) {
      var _this4 = this;

      return new Promise(function (resolve, reject) {
        _this4._socket.emit(requestName, requestData, function (status, data) {
          handleResponse(status, data, resolve, reject);
        });
      });
    }
    /**
     * @function _onReconnectionTicket
     * @instance
     * @desc Parse reconnection ticket and schedule ticket refreshing.
     * @memberof Owt.Conference.SioSignaling
     * @private.
     */

  }, {
    key: "_onReconnectionTicket",
    value: function _onReconnectionTicket(ticketString) {
      var _this5 = this;

      this._reconnectionTicket = ticketString;
      var ticket = JSON.parse(_base.Base64.decodeBase64(ticketString)); // Refresh ticket 1 min or 10 seconds before it expires.

      var now = Date.now();
      var millisecondsInOneMinute = 60 * 1000;
      var millisecondsInTenSeconds = 10 * 1000;

      if (ticket.notAfter <= now - millisecondsInTenSeconds) {
        _logger.default.warning('Reconnection ticket expires too soon.');

        return;
      }

      var refreshAfter = ticket.notAfter - now - millisecondsInOneMinute;

      if (refreshAfter < 0) {
        refreshAfter = ticket.notAfter - now - millisecondsInTenSeconds;
      }

      this._clearReconnectionTask();

      this._refreshReconnectionTicket = setTimeout(function () {
        _this5._socket.emit('refreshReconnectionTicket', function (status, data) {
          if (status !== 'ok') {
            _logger.default.warning('Failed to refresh reconnection ticket.');

            return;
          }

          _this5._onReconnectionTicket(data);
        });
      }, refreshAfter);
    }
  }, {
    key: "_clearReconnectionTask",
    value: function _clearReconnectionTask() {
      clearTimeout(this._refreshReconnectionTicket);
      this._refreshReconnectionTicket = null;
    }
  }]);

  return SioSignaling;
}(EventModule.EventDispatcher);

exports.SioSignaling = SioSignaling;

},{"../base/base64.js":1,"../base/event.js":3,"../base/logger.js":5,"./error.js":14}],20:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
// This file doesn't have public APIs.

/* eslint-disable valid-jsdoc */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.convertToPublicationSettings = convertToPublicationSettings;
exports.convertToSubscriptionCapabilities = convertToSubscriptionCapabilities;

var PublicationModule = _interopRequireWildcard(require("../base/publication.js"));

var MediaFormatModule = _interopRequireWildcard(require("../base/mediaformat.js"));

var CodecModule = _interopRequireWildcard(require("../base/codec.js"));

var SubscriptionModule = _interopRequireWildcard(require("./subscription.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

/**
 * @function extractBitrateMultiplier
 * @desc Extract bitrate multiplier from a string like "x0.2".
 * @return {Promise<Object, Error>} The float number after "x".
 * @private
 */
function extractBitrateMultiplier(input) {
  if (typeof input !== 'string' || !input.startsWith('x')) {
    L.Logger.warning('Invalid bitrate multiplier input.');
    return 0;
  }

  return Number.parseFloat(input.replace(/^x/, ''));
} // eslint-disable-next-line require-jsdoc


function sortNumbers(x, y) {
  return x - y;
} // eslint-disable-next-line require-jsdoc


function sortResolutions(x, y) {
  if (x.width !== y.width) {
    return x.width - y.width;
  } else {
    return x.height - y.height;
  }
}
/**
 * @function convertToPublicationSettings
 * @desc Convert mediaInfo received from server to PublicationSettings.
 * @private
 */


function convertToPublicationSettings(mediaInfo) {
  var audio = [],
      video = [];
  var audioCodec, videoCodec, resolution, framerate, bitrate, keyFrameInterval, rid;

  if (mediaInfo.audio) {
    if (mediaInfo.audio.format) {
      audioCodec = new CodecModule.AudioCodecParameters(mediaInfo.audio.format.codec, mediaInfo.audio.format.channelNum, mediaInfo.audio.format.sampleRate);
    }

    audio.push(new PublicationModule.AudioPublicationSettings(audioCodec));
  }

  if (mediaInfo.video) {
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = mediaInfo.video.original[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var videoInfo = _step.value;

        if (videoInfo.format) {
          videoCodec = new CodecModule.VideoCodecParameters(videoInfo.format.codec, videoInfo.format.profile);
        }

        if (videoInfo.parameters) {
          if (videoInfo.parameters.resolution) {
            resolution = new MediaFormatModule.Resolution(videoInfo.parameters.resolution.width, videoInfo.parameters.resolution.height);
          }

          framerate = videoInfo.parameters.framerate;
          bitrate = videoInfo.parameters.bitrate * 1000;
          keyFrameInterval = videoInfo.parameters.keyFrameInterval;
        }

        if (videoInfo.simulcastRid) {
          rid = videoInfo.simulcastRid;
        }

        video.push(new PublicationModule.VideoPublicationSettings(videoCodec, resolution, framerate, bitrate, keyFrameInterval, rid));
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return != null) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
  }

  return new PublicationModule.PublicationSettings(audio, video);
}
/**
 * @function convertToSubscriptionCapabilities
 * @desc Convert mediaInfo received from server to SubscriptionCapabilities.
 * @private
 */


function convertToSubscriptionCapabilities(mediaInfo) {
  var audio;
  var video;

  if (mediaInfo.audio) {
    var audioCodecs = [];

    if (mediaInfo.audio && mediaInfo.audio.optional && mediaInfo.audio.optional.format) {
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = mediaInfo.audio.optional.format[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var audioCodecInfo = _step2.value;
          var audioCodec = new CodecModule.AudioCodecParameters(audioCodecInfo.codec, audioCodecInfo.channelNum, audioCodecInfo.sampleRate);
          audioCodecs.push(audioCodec);
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
            _iterator2.return();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }
    }

    audioCodecs.sort();
    audio = new SubscriptionModule.AudioSubscriptionCapabilities(audioCodecs);
  }

  if (mediaInfo.video) {
    var videoCodecs = [];

    if (mediaInfo.video && mediaInfo.video.optional && mediaInfo.video.optional.format) {
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = mediaInfo.video.optional.format[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          var videoCodecInfo = _step3.value;
          var videoCodec = new CodecModule.VideoCodecParameters(videoCodecInfo.codec, videoCodecInfo.profile);
          videoCodecs.push(videoCodec);
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
            _iterator3.return();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }
    }

    videoCodecs.sort();

    if (mediaInfo.video && mediaInfo.video.optional && mediaInfo.video.optional.parameters) {
      var resolutions = Array.from(mediaInfo.video.optional.parameters.resolution, function (r) {
        return new MediaFormatModule.Resolution(r.width, r.height);
      });
      resolutions.sort(sortResolutions);
      var bitrates = Array.from(mediaInfo.video.optional.parameters.bitrate, function (bitrate) {
        return extractBitrateMultiplier(bitrate);
      });
      bitrates.push(1.0);
      bitrates.sort(sortNumbers);
      var frameRates = JSON.parse(JSON.stringify(mediaInfo.video.optional.parameters.framerate));
      frameRates.sort(sortNumbers);
      var keyFrameIntervals = JSON.parse(JSON.stringify(mediaInfo.video.optional.parameters.keyFrameInterval));
      keyFrameIntervals.sort(sortNumbers);
      video = new SubscriptionModule.VideoSubscriptionCapabilities(videoCodecs, resolutions, frameRates, bitrates, keyFrameIntervals);
    } else {
      video = new SubscriptionModule.VideoSubscriptionCapabilities(videoCodecs, [], [], [1.0], []);
    }
  }

  return new SubscriptionModule.SubscriptionCapabilities(audio, video);
}

},{"../base/codec.js":2,"../base/mediaformat.js":6,"../base/publication.js":8,"./subscription.js":21}],21:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Subscription = exports.SubscriptionUpdateOptions = exports.VideoSubscriptionUpdateOptions = exports.SubscribeOptions = exports.VideoSubscriptionConstraints = exports.AudioSubscriptionConstraints = exports.SubscriptionCapabilities = exports.VideoSubscriptionCapabilities = exports.AudioSubscriptionCapabilities = void 0;

var MediaFormatModule = _interopRequireWildcard(require("../base/mediaformat.js"));

var CodecModule = _interopRequireWildcard(require("../base/codec.js"));

var _event = require("../base/event.js");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * @class AudioSubscriptionCapabilities
 * @memberOf Owt.Conference
 * @classDesc Represents the audio capability for subscription.
 * @hideconstructor
 */
var AudioSubscriptionCapabilities = // eslint-disable-next-line require-jsdoc
function AudioSubscriptionCapabilities(codecs) {
  _classCallCheck(this, AudioSubscriptionCapabilities);

  /**
   * @member {Array.<Owt.Base.AudioCodecParameters>} codecs
   * @instance
   * @memberof Owt.Conference.AudioSubscriptionCapabilities
   */
  this.codecs = codecs;
};
/**
 * @class VideoSubscriptionCapabilities
 * @memberOf Owt.Conference
 * @classDesc Represents the video capability for subscription.
 * @hideconstructor
 */


exports.AudioSubscriptionCapabilities = AudioSubscriptionCapabilities;

var VideoSubscriptionCapabilities = // eslint-disable-next-line require-jsdoc
function VideoSubscriptionCapabilities(codecs, resolutions, frameRates, bitrateMultipliers, keyFrameIntervals) {
  _classCallCheck(this, VideoSubscriptionCapabilities);

  /**
   * @member {Array.<Owt.Base.VideoCodecParameters>} codecs
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionCapabilities
   */
  this.codecs = codecs;
  /**
   * @member {Array.<Owt.Base.Resolution>} resolutions
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionCapabilities
   */

  this.resolutions = resolutions;
  /**
   * @member {Array.<number>} frameRates
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionCapabilities
   */

  this.frameRates = frameRates;
  /**
   * @member {Array.<number>} bitrateMultipliers
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionCapabilities
   */

  this.bitrateMultipliers = bitrateMultipliers;
  /**
   * @member {Array.<number>} keyFrameIntervals
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionCapabilities
   */

  this.keyFrameIntervals = keyFrameIntervals;
};
/**
 * @class SubscriptionCapabilities
 * @memberOf Owt.Conference
 * @classDesc Represents the capability for subscription.
 * @hideconstructor
 */


exports.VideoSubscriptionCapabilities = VideoSubscriptionCapabilities;

var SubscriptionCapabilities = // eslint-disable-next-line require-jsdoc
function SubscriptionCapabilities(audio, video) {
  _classCallCheck(this, SubscriptionCapabilities);

  /**
   * @member {?Owt.Conference.AudioSubscriptionCapabilities} audio
   * @instance
   * @memberof Owt.Conference.SubscriptionCapabilities
   */
  this.audio = audio;
  /**
   * @member {?Owt.Conference.VideoSubscriptionCapabilities} video
   * @instance
   * @memberof Owt.Conference.SubscriptionCapabilities
   */

  this.video = video;
};
/**
 * @class AudioSubscriptionConstraints
 * @memberOf Owt.Conference
 * @classDesc Represents the audio constraints for subscription.
 * @hideconstructor
 */


exports.SubscriptionCapabilities = SubscriptionCapabilities;

var AudioSubscriptionConstraints = // eslint-disable-next-line require-jsdoc
function AudioSubscriptionConstraints(codecs) {
  _classCallCheck(this, AudioSubscriptionConstraints);

  /**
   * @member {?Array.<Owt.Base.AudioCodecParameters>} codecs
   * @instance
   * @memberof Owt.Conference.AudioSubscriptionConstraints
   * @desc Codecs accepted. If none of `codecs` supported by both sides, connection fails. Leave it undefined will use all possible codecs.
   */
  this.codecs = codecs;
};
/**
 * @class VideoSubscriptionConstraints
 * @memberOf Owt.Conference
 * @classDesc Represents the video constraints for subscription.
 * @hideconstructor
 */


exports.AudioSubscriptionConstraints = AudioSubscriptionConstraints;

var VideoSubscriptionConstraints = // eslint-disable-next-line require-jsdoc
function VideoSubscriptionConstraints(codecs, resolution, frameRate, bitrateMultiplier, keyFrameInterval, rid) {
  _classCallCheck(this, VideoSubscriptionConstraints);

  /**
   * @member {?Array.<Owt.Base.VideoCodecParameters>} codecs
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Codecs accepted. If none of `codecs` supported by both sides, connection fails. Leave it undefined will use all possible codecs.
   */
  this.codecs = codecs;
  /**
   * @member {?Owt.Base.Resolution} resolution
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Only resolutions listed in Owt.Conference.VideoSubscriptionCapabilities are allowed.
   */

  this.resolution = resolution;
  /**
   * @member {?number} frameRate
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Only frameRates listed in Owt.Conference.VideoSubscriptionCapabilities are allowed.
   */

  this.frameRate = frameRate;
  /**
   * @member {?number} bitrateMultiplier
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Only bitrateMultipliers listed in Owt.Conference.VideoSubscriptionCapabilities are allowed.
   */

  this.bitrateMultiplier = bitrateMultiplier;
  /**
   * @member {?number} keyFrameInterval
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Only keyFrameIntervals listed in Owt.Conference.VideoSubscriptionCapabilities are allowed.
   */

  this.keyFrameInterval = keyFrameInterval;
  /**
   * @member {?number} rid
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionConstraints
   * @desc Restriction identifier to identify the RTP Streams within an RTP session. When rid is specified, other constraints will be ignored.
   */

  this.rid = rid;
};
/**
 * @class SubscribeOptions
 * @memberOf Owt.Conference
 * @classDesc SubscribeOptions defines options for subscribing a Owt.Base.RemoteStream.
 */


exports.VideoSubscriptionConstraints = VideoSubscriptionConstraints;

var SubscribeOptions = // eslint-disable-next-line require-jsdoc
function SubscribeOptions(audio, video) {
  _classCallCheck(this, SubscribeOptions);

  /**
   * @member {?Owt.Conference.AudioSubscriptionConstraints} audio
   * @instance
   * @memberof Owt.Conference.SubscribeOptions
   */
  this.audio = audio;
  /**
   * @member {?Owt.Conference.VideoSubscriptionConstraints} video
   * @instance
   * @memberof Owt.Conference.SubscribeOptions
   */

  this.video = video;
};
/**
 * @class VideoSubscriptionUpdateOptions
 * @memberOf Owt.Conference
 * @classDesc VideoSubscriptionUpdateOptions defines options for updating a subscription's video part.
 * @hideconstructor
 */


exports.SubscribeOptions = SubscribeOptions;

var VideoSubscriptionUpdateOptions = // eslint-disable-next-line require-jsdoc
function VideoSubscriptionUpdateOptions() {
  _classCallCheck(this, VideoSubscriptionUpdateOptions);

  /**
   * @member {?Owt.Base.Resolution} resolution
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionUpdateOptions
   * @desc Only resolutions listed in VideoSubscriptionCapabilities are allowed.
   */
  this.resolution = undefined;
  /**
   * @member {?number} frameRates
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionUpdateOptions
   * @desc Only frameRates listed in VideoSubscriptionCapabilities are allowed.
   */

  this.frameRate = undefined;
  /**
   * @member {?number} bitrateMultipliers
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionUpdateOptions
   * @desc Only bitrateMultipliers listed in VideoSubscriptionCapabilities are allowed.
   */

  this.bitrateMultipliers = undefined;
  /**
   * @member {?number} keyFrameIntervals
   * @instance
   * @memberof Owt.Conference.VideoSubscriptionUpdateOptions
   * @desc Only keyFrameIntervals listed in VideoSubscriptionCapabilities are allowed.
   */

  this.keyFrameInterval = undefined;
};
/**
 * @class SubscriptionUpdateOptions
 * @memberOf Owt.Conference
 * @classDesc SubscriptionUpdateOptions defines options for updating a subscription.
 * @hideconstructor
 */


exports.VideoSubscriptionUpdateOptions = VideoSubscriptionUpdateOptions;

var SubscriptionUpdateOptions = // eslint-disable-next-line require-jsdoc
function SubscriptionUpdateOptions() {
  _classCallCheck(this, SubscriptionUpdateOptions);

  /**
   * @member {?VideoSubscriptionUpdateOptions} video
   * @instance
   * @memberof Owt.Conference.SubscriptionUpdateOptions
   */
  this.video = undefined;
};
/**
 * @class Subscription
 * @memberof Owt.Conference
 * @classDesc Subscription is a receiver for receiving a stream.
 * Events:
 *
 * | Event Name      | Argument Type    | Fired when       |
 * | ----------------| ---------------- | ---------------- |
 * | ended           | Event            | Subscription is ended. |
 * | error           | ErrorEvent       | An error occurred on the subscription. |
 * | mute            | MuteEvent        | Publication is muted. Remote side stopped sending audio and/or video data. |
 * | unmute          | MuteEvent        | Publication is unmuted. Remote side continued sending audio and/or video data. |
 *
 * @extends Owt.Base.EventDispatcher
 * @hideconstructor
 */


exports.SubscriptionUpdateOptions = SubscriptionUpdateOptions;

var Subscription =
/*#__PURE__*/
function (_EventDispatcher) {
  _inherits(Subscription, _EventDispatcher);

  // eslint-disable-next-line require-jsdoc
  function Subscription(id, stop, getStats, mute, unmute, applyOptions) {
    var _this;

    _classCallCheck(this, Subscription);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(Subscription).call(this));

    if (!id) {
      throw new TypeError('ID cannot be null or undefined.');
    }
    /**
     * @member {string} id
     * @instance
     * @memberof Owt.Conference.Subscription
     */


    Object.defineProperty(_assertThisInitialized(_assertThisInitialized(_this)), 'id', {
      configurable: false,
      writable: false,
      value: id
    });
    /**
     * @function stop
     * @instance
     * @desc Stop certain subscription. Once a subscription is stopped, it cannot be recovered.
     * @memberof Owt.Conference.Subscription
     * @returns {undefined}
     */

    _this.stop = stop;
    /**
     * @function getStats
     * @instance
     * @desc Get stats of underlying PeerConnection.
     * @memberof Owt.Conference.Subscription
     * @returns {Promise<RTCStatsReport, Error>}
     */

    _this.getStats = getStats;
    /**
     * @function mute
     * @instance
     * @desc Stop reeving data from remote endpoint.
     * @memberof Owt.Conference.Subscription
     * @param {Owt.Base.TrackKind } kind Kind of tracks to be muted.
     * @returns {Promise<undefined, Error>}
     */

    _this.mute = mute;
    /**
     * @function unmute
     * @instance
     * @desc Continue reeving data from remote endpoint.
     * @memberof Owt.Conference.Subscription
     * @param {Owt.Base.TrackKind } kind Kind of tracks to be unmuted.
     * @returns {Promise<undefined, Error>}
     */

    _this.unmute = unmute;
    /**
     * @function applyOptions
     * @instance
     * @desc Update subscription with given options.
     * @memberof Owt.Conference.Subscription
     * @param {Owt.Conference.SubscriptionUpdateOptions } options Subscription update options.
     * @returns {Promise<undefined, Error>}
     */

    _this.applyOptions = applyOptions;
    return _this;
  }

  return Subscription;
}(_event.EventDispatcher);

exports.Subscription = Subscription;

},{"../base/codec.js":2,"../base/event.js":3,"../base/mediaformat.js":6}],22:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Conference = exports.P2P = exports.Base = void 0;

var base = _interopRequireWildcard(require("./base/export.js"));

var p2p = _interopRequireWildcard(require("./p2p/export.js"));

var conference = _interopRequireWildcard(require("./conference/export.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

/**
 * Base objects for both P2P and conference.
 * @namespace Owt.Base
 */
var Base = base;
/**
 * P2P WebRTC connections.
 * @namespace Owt.P2P
 */

exports.Base = Base;
var P2P = p2p;
/**
 * WebRTC connections with conference server.
 * @namespace Owt.Conference
 */

exports.P2P = P2P;
var Conference = conference;
exports.Conference = Conference;

},{"./base/export.js":4,"./conference/export.js":15,"./p2p/export.js":24}],23:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getErrorByCode = getErrorByCode;
exports.P2PError = exports.errors = void 0;

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _wrapNativeSuper(Class) { var _cache = typeof Map === "function" ? new Map() : undefined; _wrapNativeSuper = function _wrapNativeSuper(Class) { if (Class === null || !_isNativeFunction(Class)) return Class; if (typeof Class !== "function") { throw new TypeError("Super expression must either be null or a function"); } if (typeof _cache !== "undefined") { if (_cache.has(Class)) return _cache.get(Class); _cache.set(Class, Wrapper); } function Wrapper() { return _construct(Class, arguments, _getPrototypeOf(this).constructor); } Wrapper.prototype = Object.create(Class.prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } }); return _setPrototypeOf(Wrapper, Class); }; return _wrapNativeSuper(Class); }

function isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

function _construct(Parent, args, Class) { if (isNativeReflectConstruct()) { _construct = Reflect.construct; } else { _construct = function _construct(Parent, args, Class) { var a = [null]; a.push.apply(a, args); var Constructor = Function.bind.apply(Parent, a); var instance = new Constructor(); if (Class) _setPrototypeOf(instance, Class.prototype); return instance; }; } return _construct.apply(null, arguments); }

function _isNativeFunction(fn) { return Function.toString.call(fn).indexOf("[native code]") !== -1; }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

var errors = {
  // 2100-2999 for P2P errors
  // 2100-2199 for connection errors
  // 2100-2109 for server errors
  P2P_CONN_SERVER_UNKNOWN: {
    code: 2100,
    message: 'Server unknown error.'
  },
  P2P_CONN_SERVER_UNAVAILABLE: {
    code: 2101,
    message: 'Server is unavaliable.'
  },
  P2P_CONN_SERVER_BUSY: {
    code: 2102,
    message: 'Server is too busy.'
  },
  P2P_CONN_SERVER_NOT_SUPPORTED: {
    code: 2103,
    message: 'Method has not been supported by server.'
  },
  // 2110-2119 for client errors
  P2P_CONN_CLIENT_UNKNOWN: {
    code: 2110,
    message: 'Client unknown error.'
  },
  P2P_CONN_CLIENT_NOT_INITIALIZED: {
    code: 2111,
    message: 'Connection is not initialized.'
  },
  // 2120-2129 for authentication errors
  P2P_CONN_AUTH_UNKNOWN: {
    code: 2120,
    message: 'Authentication unknown error.'
  },
  P2P_CONN_AUTH_FAILED: {
    code: 2121,
    message: 'Wrong username or token.'
  },
  // 2200-2299 for message transport errors
  P2P_MESSAGING_TARGET_UNREACHABLE: {
    code: 2201,
    message: 'Remote user cannot be reached.'
  },
  P2P_CLIENT_DENIED: {
    code: 2202,
    message: 'User is denied.'
  },
  // 2301-2399 for chat room errors
  // 2401-2499 for client errors
  P2P_CLIENT_UNKNOWN: {
    code: 2400,
    message: 'Unknown errors.'
  },
  P2P_CLIENT_UNSUPPORTED_METHOD: {
    code: 2401,
    message: 'This method is unsupported in current browser.'
  },
  P2P_CLIENT_ILLEGAL_ARGUMENT: {
    code: 2402,
    message: 'Illegal argument.'
  },
  P2P_CLIENT_INVALID_STATE: {
    code: 2403,
    message: 'Invalid peer state.'
  },
  P2P_CLIENT_NOT_ALLOWED: {
    code: 2404,
    message: 'Remote user is not allowed.'
  },
  // 2501-2599 for WebRTC erros.
  P2P_WEBRTC_UNKNOWN: {
    code: 2500,
    message: 'WebRTC error.'
  },
  P2P_WEBRTC_SDP: {
    code: 2502,
    message: 'SDP error.'
  }
};
/**
 * @function getErrorByCode
 * @desc Get error object by error code.
 * @param {string} errorCode Error code.
 * @return {Owt.P2P.Error} Error object
 * @private
 */

exports.errors = errors;

function getErrorByCode(errorCode) {
  var codeErrorMap = {
    2100: errors.P2P_CONN_SERVER_UNKNOWN,
    2101: errors.P2P_CONN_SERVER_UNAVAILABLE,
    2102: errors.P2P_CONN_SERVER_BUSY,
    2103: errors.P2P_CONN_SERVER_NOT_SUPPORTED,
    2110: errors.P2P_CONN_CLIENT_UNKNOWN,
    2111: errors.P2P_CONN_CLIENT_NOT_INITIALIZED,
    2120: errors.P2P_CONN_AUTH_UNKNOWN,
    2121: errors.P2P_CONN_AUTH_FAILED,
    2201: errors.P2P_MESSAGING_TARGET_UNREACHABLE,
    2400: errors.P2P_CLIENT_UNKNOWN,
    2401: errors.P2P_CLIENT_UNSUPPORTED_METHOD,
    2402: errors.P2P_CLIENT_ILLEGAL_ARGUMENT,
    2403: errors.P2P_CLIENT_INVALID_STATE,
    2404: errors.P2P_CLIENT_NOT_ALLOWED,
    2500: errors.P2P_WEBRTC_UNKNOWN,
    2501: errors.P2P_WEBRTC_SDP
  };
  return codeErrorMap[errorCode];
}
/**
 * @class P2PError
 * @classDesc The P2PError object represents an error in P2P mode.
 * @memberOf Owt.P2P
 * @hideconstructor
 */


var P2PError =
/*#__PURE__*/
function (_Error) {
  _inherits(P2PError, _Error);

  // eslint-disable-next-line require-jsdoc
  function P2PError(error, message) {
    var _this;

    _classCallCheck(this, P2PError);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(P2PError).call(this, message));

    if (typeof error === 'number') {
      _this.code = error;
    } else {
      _this.code = error.code;
    }

    return _this;
  }

  return P2PError;
}(_wrapNativeSuper(Error));

exports.P2PError = P2PError;

},{}],24:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "P2PClient", {
  enumerable: true,
  get: function get() {
    return _p2pclient.default;
  }
});
Object.defineProperty(exports, "P2PError", {
  enumerable: true,
  get: function get() {
    return _error.P2PError;
  }
});

var _p2pclient = _interopRequireDefault(require("./p2pclient.js"));

var _error = require("./error.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./error.js":23,"./p2pclient.js":25}],25:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/* global Map, Promise */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _logger = _interopRequireDefault(require("../base/logger.js"));

var _event = require("../base/event.js");

var Utils = _interopRequireWildcard(require("../base/utils.js"));

var ErrorModule = _interopRequireWildcard(require("./error.js"));

var _peerconnectionChannel = _interopRequireDefault(require("./peerconnection-channel.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var ConnectionState = {
  READY: 1,
  CONNECTING: 2,
  CONNECTED: 3
};
/* eslint-disable no-unused-vars */

/**
 * @class P2PClientConfiguration
 * @classDesc Configuration for P2PClient.
 * @memberOf Owt.P2P
 * @hideconstructor
 */

var P2PClientConfiguration = function P2PClientConfiguration() {
  /**
   * @member {?Array<Owt.Base.AudioEncodingParameters>} audioEncoding
   * @instance
   * @desc Encoding parameters for publishing audio tracks.
   * @memberof Owt.P2P.P2PClientConfiguration
   */
  this.audioEncoding = undefined;
  /**
   * @member {?Array<Owt.Base.VideoEncodingParameters>} videoEncoding
   * @instance
   * @desc Encoding parameters for publishing video tracks.
   * @memberof Owt.P2P.P2PClientConfiguration
   */

  this.videoEncoding = undefined;
  /**
   * @member {?RTCConfiguration} rtcConfiguration
   * @instance
   * @memberof Owt.P2P.P2PClientConfiguration
   * @desc It will be used for creating PeerConnection.
   * @see {@link https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary|RTCConfiguration Dictionary of WebRTC 1.0}.
   * @example
   * // Following object can be set to p2pClientConfiguration.rtcConfiguration.
   * {
   *   iceServers: [{
   *      urls: "stun:example.com:3478"
   *   }, {
   *     urls: [
   *       "turn:example.com:3478?transport=udp",
   *       "turn:example.com:3478?transport=tcp"
   *     ],
   *      credential: "password",
   *      username: "username"
   *   }
   * }
   */

  this.rtcConfiguration = undefined;
};
/* eslint-enable no-unused-vars */

/**
 * @class P2PClient
 * @classDesc The P2PClient handles PeerConnections between different clients.
 * Events:
 *
 * | Event Name            | Argument Type    | Fired when       |
 * | --------------------- | ---------------- | ---------------- |
 * | streamadded           | StreamEvent      | A new stream is sent from remote endpoint. |
 * | messagereceived       | MessageEvent     | A new message is received. |
 * | serverdisconnected    | OwtEvent         | Disconnected from signaling server. |
 *
 * @memberof Owt.P2P
 * @extends Owt.Base.EventDispatcher
 * @constructor
 * @param {?Owt.P2P.P2PClientConfiguration } configuration Configuration for Owt.P2P.P2PClient.
 * @param {Object} signalingChannel A channel for sending and receiving signaling messages.
 */


var P2PClient = function P2PClient(configuration, signalingChannel) {
  Object.setPrototypeOf(this, new _event.EventDispatcher());
  var config = configuration;
  var signaling = signalingChannel;
  var channels = new Map(); // Map of PeerConnectionChannels.

  var self = this;
  var state = ConnectionState.READY;
  var myId;

  signaling.onMessage = function (origin, message) {
    _logger.default.debug('Received signaling message from ' + origin + ': ' + message);

    var data = JSON.parse(message);

    if (data.type === 'chat-closed') {
      if (channels.has(origin)) {
        getOrCreateChannel(origin).onMessage(data);
        channels.delete(origin);
      }

      return;
    }

    if (self.allowedRemoteIds.indexOf(origin) >= 0) {
      getOrCreateChannel(origin).onMessage(data);
    } else {
      sendSignalingMessage(origin, 'chat-closed', ErrorModule.errors.P2P_CLIENT_DENIED);
    }
  };

  signaling.onServerDisconnected = function () {
    state = ConnectionState.READY;
    self.dispatchEvent(new _event.OwtEvent('serverdisconnected'));
  };
  /**
   * @member {array} allowedRemoteIds
   * @memberof Owt.P2P.P2PClient
   * @instance
   * @desc Only allowed remote endpoint IDs are able to publish stream or send message to current endpoint. Removing an ID from allowedRemoteIds does stop existing connection with certain endpoint. Please call stop to stop the PeerConnection.
   */


  this.allowedRemoteIds = [];
  /**
   * @function connect
   * @instance
   * @desc Connect to signaling server. Since signaling can be customized, this method does not define how a token looks like. SDK passes token to signaling channel without changes.
   * @memberof Owt.P2P.P2PClient
   * @param {string} token A token for connecting to signaling server. The format of this token depends on signaling server's requirement.
   * @return {Promise<object, Error>} It returns a promise resolved with an object returned by signaling channel once signaling channel reports connection has been established.
   */

  this.connect = function (token) {
    if (state === ConnectionState.READY) {
      state = ConnectionState.CONNECTING;
    } else {
      _logger.default.warning('Invalid connection state: ' + state);

      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE));
    }

    return new Promise(function (resolve, reject) {
      signaling.connect(token).then(function (id) {
        myId = id;
        state = ConnectionState.CONNECTED;
        resolve(myId);
      }, function (errCode) {
        reject(new ErrorModule.P2PError(ErrorModule.getErrorByCode(errCode)));
      });
    });
  };
  /**
   * @function disconnect
   * @instance
   * @desc Disconnect from the signaling channel. It stops all existing sessions with remote endpoints.
   * @memberof Owt.P2P.P2PClient
   * @returns {Promise<undefined, Error>}
   */


  this.disconnect = function () {
    if (state == ConnectionState.READY) {
      return;
    }

    channels.forEach(function (channel) {
      channel.stop();
    });
    channels.clear();
    signaling.disconnect();
  };
  /**
   * @function publish
   * @instance
   * @desc Publish a stream to a remote endpoint.
   * @memberof Owt.P2P.P2PClient
   * @param {string} remoteId Remote endpoint's ID.
   * @param {Owt.Base.LocalStream} stream An Owt.Base.LocalStream to be published.
   * @return {Promise<Owt.Base.Publication, Error>} A promised that resolves when remote side received the certain stream. However, remote endpoint may not display this stream, or ignore it.
   */


  this.publish = function (remoteId, stream) {
    if (state !== ConnectionState.CONNECTED) {
      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE, 'P2P Client is not connected to signaling channel.'));
    }

    if (this.allowedRemoteIds.indexOf(remoteId) < 0) {
      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_NOT_ALLOWED));
    }

    return Promise.resolve(getOrCreateChannel(remoteId).publish(stream));
  };
  /**
   * @function send
   * @instance
   * @desc Send a message to remote endpoint.
   * @memberof Owt.P2P.P2PClient
   * @param {string} remoteId Remote endpoint's ID.
   * @param {string} message Message to be sent. It should be a string.
   * @return {Promise<undefined, Error>} It returns a promise resolved when remote endpoint received certain message.
   */


  this.send = function (remoteId, message) {
    if (state !== ConnectionState.CONNECTED) {
      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE, 'P2P Client is not connected to signaling channel.'));
    }

    if (this.allowedRemoteIds.indexOf(remoteId) < 0) {
      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_NOT_ALLOWED));
    }

    return Promise.resolve(getOrCreateChannel(remoteId).send(message));
  };
  /**
   * @function stop
   * @instance
   * @desc Clean all resources associated with given remote endpoint. It may include RTCPeerConnection, RTCRtpTransceiver and RTCDataChannel. It still possible to publish a stream, or send a message to given remote endpoint after stop.
   * @memberof Owt.P2P.P2PClient
   * @param {string} remoteId Remote endpoint's ID.
   * @return {undefined}
   */


  this.stop = function (remoteId) {
    if (!channels.has(remoteId)) {
      _logger.default.warning('No PeerConnection between current endpoint and specific remote ' + 'endpoint.');

      return;
    }

    channels.get(remoteId).stop();
    channels.delete(remoteId);
  };
  /**
   * @function getStats
   * @instance
   * @desc Get stats of underlying PeerConnection.
   * @memberof Owt.P2P.P2PClient
   * @param {string} remoteId Remote endpoint's ID.
   * @return {Promise<RTCStatsReport, Error>} It returns a promise resolved with an RTCStatsReport or reject with an Error if there is no connection with specific user.
   */


  this.getStats = function (remoteId) {
    if (!channels.has(remoteId)) {
      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE, 'No PeerConnection between current endpoint and specific remote ' + 'endpoint.'));
    }

    return channels.get(remoteId).getStats();
  };

  var sendSignalingMessage = function sendSignalingMessage(remoteId, type, message) {
    var msg = {
      type: type
    };

    if (message) {
      msg.data = message;
    }

    return signaling.send(remoteId, JSON.stringify(msg)).catch(function (e) {
      if (typeof e === 'number') {
        throw ErrorModule.getErrorByCode(e);
      }
    });
  };

  var getOrCreateChannel = function getOrCreateChannel(remoteId) {
    if (!channels.has(remoteId)) {
      // Construct an signaling sender/receiver for P2PPeerConnection.
      var signalingForChannel = Object.create(_event.EventDispatcher);
      signalingForChannel.sendSignalingMessage = sendSignalingMessage;
      var pcc = new _peerconnectionChannel.default(config, myId, remoteId, signalingForChannel);
      pcc.addEventListener('streamadded', function (streamEvent) {
        self.dispatchEvent(streamEvent);
      });
      pcc.addEventListener('messagereceived', function (messageEvent) {
        self.dispatchEvent(messageEvent);
      });
      pcc.addEventListener('ended', function () {
        channels.delete(remoteId);
      });
      channels.set(remoteId, pcc);
    }

    return channels.get(remoteId);
  };
};

var _default = P2PClient;
exports.default = _default;

},{"../base/event.js":3,"../base/logger.js":5,"../base/utils.js":11,"./error.js":23,"./peerconnection-channel.js":26}],26:[function(require,module,exports){
// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
// This file doesn't have public APIs.

/* eslint-disable valid-jsdoc */

/* eslint-disable require-jsdoc */

/* global Event, Map, Promise, RTCIceCandidate */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.P2PPeerConnectionChannelEvent = void 0;

var _logger = _interopRequireDefault(require("../base/logger.js"));

var _event = require("../base/event.js");

var _publication = require("../base/publication.js");

var Utils = _interopRequireWildcard(require("../base/utils.js"));

var ErrorModule = _interopRequireWildcard(require("./error.js"));

var StreamModule = _interopRequireWildcard(require("../base/stream.js"));

var SdpUtils = _interopRequireWildcard(require("../base/sdputils.js"));

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = Object.defineProperty && Object.getOwnPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : {}; if (desc.get || desc.set) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _wrapNativeSuper(Class) { var _cache = typeof Map === "function" ? new Map() : undefined; _wrapNativeSuper = function _wrapNativeSuper(Class) { if (Class === null || !_isNativeFunction(Class)) return Class; if (typeof Class !== "function") { throw new TypeError("Super expression must either be null or a function"); } if (typeof _cache !== "undefined") { if (_cache.has(Class)) return _cache.get(Class); _cache.set(Class, Wrapper); } function Wrapper() { return _construct(Class, arguments, _getPrototypeOf(this).constructor); } Wrapper.prototype = Object.create(Class.prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } }); return _setPrototypeOf(Wrapper, Class); }; return _wrapNativeSuper(Class); }

function isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

function _construct(Parent, args, Class) { if (isNativeReflectConstruct()) { _construct = Reflect.construct; } else { _construct = function _construct(Parent, args, Class) { var a = [null]; a.push.apply(a, args); var Constructor = Function.bind.apply(Parent, a); var instance = new Constructor(); if (Class) _setPrototypeOf(instance, Class.prototype); return instance; }; } return _construct.apply(null, arguments); }

function _isNativeFunction(fn) { return Function.toString.call(fn).indexOf("[native code]") !== -1; }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

/**
 * @class P2PPeerConnectionChannelEvent
 * @desc Event for Stream.
 * @memberOf Owt.P2P
 * @private
 * */
var P2PPeerConnectionChannelEvent =
/*#__PURE__*/
function (_Event) {
  _inherits(P2PPeerConnectionChannelEvent, _Event);

  /* eslint-disable-next-line require-jsdoc */
  function P2PPeerConnectionChannelEvent(init) {
    var _this;

    _classCallCheck(this, P2PPeerConnectionChannelEvent);

    _this = _possibleConstructorReturn(this, _getPrototypeOf(P2PPeerConnectionChannelEvent).call(this, init));
    _this.stream = init.stream;
    return _this;
  }

  return P2PPeerConnectionChannelEvent;
}(_wrapNativeSuper(Event));

exports.P2PPeerConnectionChannelEvent = P2PPeerConnectionChannelEvent;
var DataChannelLabel = {
  MESSAGE: 'message',
  FILE: 'file'
};
var SignalingType = {
  DENIED: 'chat-denied',
  CLOSED: 'chat-closed',
  NEGOTIATION_NEEDED: 'chat-negotiation-needed',
  TRACK_SOURCES: 'chat-track-sources',
  STREAM_INFO: 'chat-stream-info',
  SDP: 'chat-signal',
  TRACKS_ADDED: 'chat-tracks-added',
  TRACKS_REMOVED: 'chat-tracks-removed',
  DATA_RECEIVED: 'chat-data-received',
  UA: 'chat-ua'
};
var sysInfo = Utils.sysInfo();
/**
 * @class P2PPeerConnectionChannel
 * @desc A P2PPeerConnectionChannel handles all interactions between this endpoint and a remote endpoint.
 * @memberOf Owt.P2P
 * @private
 */

var P2PPeerConnectionChannel =
/*#__PURE__*/
function (_EventDispatcher) {
  _inherits(P2PPeerConnectionChannel, _EventDispatcher);

  // |signaling| is an object has a method |sendSignalingMessage|.

  /* eslint-disable-next-line require-jsdoc */
  function P2PPeerConnectionChannel(config, localId, remoteId, signaling) {
    var _this2;

    _classCallCheck(this, P2PPeerConnectionChannel);

    _this2 = _possibleConstructorReturn(this, _getPrototypeOf(P2PPeerConnectionChannel).call(this));
    _this2._config = config;
    _this2._localId = localId;
    _this2._remoteId = remoteId;
    _this2._signaling = signaling;
    _this2._pc = null;
    _this2._publishedStreams = new Map(); // Key is streams published, value is its publication.

    _this2._pendingStreams = []; // Streams going to be added to PeerConnection.

    _this2._publishingStreams = []; // Streams have been added to PeerConnection, but does not receive ack from remote side.

    _this2._pendingUnpublishStreams = []; // Streams going to be removed.
    // Key is MediaStream's ID, value is an object {source:{audio:string, video:string}, attributes: object, stream: RemoteStream, mediaStream: MediaStream}. `stream` and `mediaStream` will be set when `track` event is fired on `RTCPeerConnection`. `mediaStream` will be `null` after `streamadded` event is fired on `P2PClient`. Other propertes will be set upon `STREAM_INFO` event from signaling channel.

    _this2._remoteStreamInfo = new Map();
    _this2._remoteStreams = [];
    _this2._remoteTrackSourceInfo = new Map(); // Key is MediaStreamTrack's ID, value is source info.

    _this2._publishPromises = new Map(); // Key is MediaStream's ID, value is an object has |resolve| and |reject|.

    _this2._unpublishPromises = new Map(); // Key is MediaStream's ID, value is an object has |resolve| and |reject|.

    _this2._publishingStreamTracks = new Map(); // Key is MediaStream's ID, value is an array of the ID of its MediaStreamTracks that haven't been acked.

    _this2._publishedStreamTracks = new Map(); // Key is MediaStream's ID, value is an array of the ID of its MediaStreamTracks that haven't been removed.

    _this2._isNegotiationNeeded = false;
    _this2._remoteSideSupportsRemoveStream = true;
    _this2._remoteSideSupportsPlanB = true;
    _this2._remoteSideSupportsUnifiedPlan = true;
    _this2._remoteIceCandidates = [];
    _this2._dataChannels = new Map(); // Key is data channel's label, value is a RTCDataChannel.

    _this2._pendingMessages = [];
    _this2._dataSeq = 1; // Sequence number for data channel messages.

    _this2._sendDataPromises = new Map(); // Key is data sequence number, value is an object has |resolve| and |reject|.

    _this2._addedTrackIds = []; // Tracks that have been added after receiving remote SDP but before connection is established. Draining these messages when ICE connection state is connected.

    _this2._isCaller = true;
    _this2._infoSent = false;
    _this2._disposed = false;

    _this2._createPeerConnection();

    return _this2;
  }
  /**
   * @function publish
   * @desc Publish a stream to the remote endpoint.
   * @private
   */


  _createClass(P2PPeerConnectionChannel, [{
    key: "publish",
    value: function publish(stream) {
      var _this3 = this;

      if (!(stream instanceof StreamModule.LocalStream)) {
        return Promise.reject(new TypeError('Invalid stream.'));
      }

      if (this._publishedStreams.has(stream)) {
        return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_ILLEGAL_ARGUMENT, 'Duplicated stream.'));
      }

      if (this._areAllTracksEnded(stream.mediaStream)) {
        return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE, 'All tracks are ended.'));
      }

      return Promise.all([this._sendClosedMsgIfNecessary(), this._sendSysInfoIfNecessary(), this._sendStreamInfo(stream)]).then(function () {
        return new Promise(function (resolve, reject) {
          // Replace |addStream| with PeerConnection.addTrack when all browsers are ready.
          var _iteratorNormalCompletion = true;
          var _didIteratorError = false;
          var _iteratorError = undefined;

          try {
            for (var _iterator = stream.mediaStream.getTracks()[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
              var track = _step.value;

              _this3._pc.addTrack(track, stream.mediaStream);
            }
          } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
              }
            } finally {
              if (_didIteratorError) {
                throw _iteratorError;
              }
            }
          }

          _this3._onNegotiationneeded();

          _this3._publishingStreams.push(stream);

          var trackIds = Array.from(stream.mediaStream.getTracks(), function (track) {
            return track.id;
          });

          _this3._publishingStreamTracks.set(stream.mediaStream.id, trackIds);

          _this3._publishPromises.set(stream.mediaStream.id, {
            resolve: resolve,
            reject: reject
          });
        });
      });
    }
    /**
     * @function send
     * @desc Send a message to the remote endpoint.
     * @private
     */

  }, {
    key: "send",
    value: function send(message) {
      var _this4 = this;

      if (!(typeof message === 'string')) {
        return Promise.reject(new TypeError('Invalid message.'));
      }

      var data = {
        id: this._dataSeq++,
        data: message
      };
      var promise = new Promise(function (resolve, reject) {
        _this4._sendDataPromises.set(data.id, {
          resolve: resolve,
          reject: reject
        });
      });

      if (!this._dataChannels.has(DataChannelLabel.MESSAGE)) {
        this._createDataChannel(DataChannelLabel.MESSAGE);
      }

      this._sendClosedMsgIfNecessary().catch(function (err) {
        _logger.default.debug('Failed to send closed message.' + err.message);
      });

      this._sendSysInfoIfNecessary().catch(function (err) {
        _logger.default.debug('Failed to send sysInfo.' + err.message);
      });

      var dc = this._dataChannels.get(DataChannelLabel.MESSAGE);

      if (dc.readyState === 'open') {
        this._dataChannels.get(DataChannelLabel.MESSAGE).send(JSON.stringify(data));
      } else {
        this._pendingMessages.push(data);
      }

      return promise;
    }
    /**
     * @function stop
     * @desc Stop the connection with remote endpoint.
     * @private
     */

  }, {
    key: "stop",
    value: function stop() {
      this._stop(undefined, true);
    }
    /**
     * @function getStats
     * @desc Get stats for a specific MediaStream.
     * @private
     */

  }, {
    key: "getStats",
    value: function getStats(mediaStream) {
      var _this5 = this;

      if (this._pc) {
        if (mediaStream === undefined) {
          return this._pc.getStats();
        } else {
          var tracksStatsReports = [];
          return Promise.all([mediaStream.getTracks().forEach(function (track) {
            _this5._getStats(track, tracksStatsReports);
          })]).then(function () {
            return new Promise(function (resolve, reject) {
              resolve(tracksStatsReports);
            });
          });
        }
      } else {
        return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE));
      }
    }
  }, {
    key: "_getStats",
    value: function _getStats(mediaStreamTrack, reportsResult) {
      return this._pc.getStats(mediaStreamTrack).then(function (statsReport) {
        reportsResult.push(statsReport);
      });
    }
    /**
     * @function onMessage
     * @desc This method is called by P2PClient when there is new signaling message arrived.
     * @private
     */

  }, {
    key: "onMessage",
    value: function onMessage(message) {
      this._SignalingMesssageHandler(message);
    }
  }, {
    key: "_sendSdp",
    value: function _sendSdp(sdp) {
      return this._signaling.sendSignalingMessage(this._remoteId, SignalingType.SDP, sdp);
    }
  }, {
    key: "_sendSignalingMessage",
    value: function _sendSignalingMessage(type, message) {
      return this._signaling.sendSignalingMessage(this._remoteId, type, message);
    }
  }, {
    key: "_SignalingMesssageHandler",
    value: function _SignalingMesssageHandler(message) {
      _logger.default.debug('Channel received message: ' + message);

      switch (message.type) {
        case SignalingType.UA:
          this._handleRemoteCapability(message.data);

          this._sendSysInfoIfNecessary();

          break;

        case SignalingType.TRACK_SOURCES:
          this._trackSourcesHandler(message.data);

          break;

        case SignalingType.STREAM_INFO:
          this._streamInfoHandler(message.data);

          break;

        case SignalingType.SDP:
          this._sdpHandler(message.data);

          break;

        case SignalingType.TRACKS_ADDED:
          this._tracksAddedHandler(message.data);

          break;

        case SignalingType.TRACKS_REMOVED:
          this._tracksRemovedHandler(message.data);

          break;

        case SignalingType.DATA_RECEIVED:
          this._dataReceivedHandler(message.data);

          break;

        case SignalingType.CLOSED:
          this._chatClosedHandler(message.data);

          break;

        default:
          _logger.default.error('Invalid signaling message received. Type: ' + message.type);

      }
    }
    /**
     * @function _tracksAddedHandler
     * @desc Handle track added event from remote side.
     * @private
     */

  }, {
    key: "_tracksAddedHandler",
    value: function _tracksAddedHandler(ids) {
      var _this6 = this;

      // Currently, |ids| contains all track IDs of a MediaStream. Following algorithm also handles |ids| is a part of a MediaStream's tracks.
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        var _loop = function _loop() {
          var id = _step2.value;

          // It could be a problem if there is a track published with different MediaStreams.
          _this6._publishingStreamTracks.forEach(function (mediaTrackIds, mediaStreamId) {
            for (var i = 0; i < mediaTrackIds.length; i++) {
              if (mediaTrackIds[i] === id) {
                // Move this track from publishing tracks to published tracks.
                if (!_this6._publishedStreamTracks.has(mediaStreamId)) {
                  _this6._publishedStreamTracks.set(mediaStreamId, []);
                }

                _this6._publishedStreamTracks.get(mediaStreamId).push(mediaTrackIds[i]);

                mediaTrackIds.splice(i, 1);
              } // Resolving certain publish promise when remote endpoint received all tracks of a MediaStream.


              if (mediaTrackIds.length == 0) {
                var _ret = function () {
                  if (!_this6._publishPromises.has(mediaStreamId)) {
                    _logger.default.warning('Cannot find the promise for publishing ' + mediaStreamId);

                    return "continue";
                  }

                  var targetStreamIndex = _this6._publishingStreams.findIndex(function (element) {
                    return element.mediaStream.id == mediaStreamId;
                  });

                  var targetStream = _this6._publishingStreams[targetStreamIndex];

                  _this6._publishingStreams.splice(targetStreamIndex, 1);

                  var publication = new _publication.Publication(id, function () {
                    _this6._unpublish(targetStream).then(function () {
                      publication.dispatchEvent(new _event.OwtEvent('ended'));
                    }, function (err) {
                      // Use debug mode because this error usually doesn't block stopping a publication.
                      _logger.default.debug('Something wrong happened during stopping a ' + 'publication. ' + err.message);
                    });
                  }, function () {
                    if (!targetStream || !targetStream.mediaStream) {
                      return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_INVALID_STATE, 'Publication is not available.'));
                    }

                    return _this6.getStats(targetStream.mediaStream);
                  });

                  _this6._publishedStreams.set(targetStream, publication);

                  _this6._publishPromises.get(mediaStreamId).resolve(publication);

                  _this6._publishPromises.delete(mediaStreamId);
                }();

                if (_ret === "continue") continue;
              }
            }
          });
        };

        for (var _iterator2 = ids[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          _loop();
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
            _iterator2.return();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }
    }
    /**
     * @function _tracksRemovedHandler
     * @desc Handle track removed event from remote side.
     * @private
     */

  }, {
    key: "_tracksRemovedHandler",
    value: function _tracksRemovedHandler(ids) {
      var _this7 = this;

      // Currently, |ids| contains all track IDs of a MediaStream. Following algorithm also handles |ids| is a part of a MediaStream's tracks.
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        var _loop2 = function _loop2() {
          var id = _step3.value;

          // It could be a problem if there is a track published with different MediaStreams.
          _this7._publishedStreamTracks.forEach(function (mediaTrackIds, mediaStreamId) {
            for (var i = 0; i < mediaTrackIds.length; i++) {
              if (mediaTrackIds[i] === id) {
                mediaTrackIds.splice(i, 1);
              }
            }
          });
        };

        for (var _iterator3 = ids[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          _loop2();
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
            _iterator3.return();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }
    }
    /**
     * @function _dataReceivedHandler
     * @desc Handle data received event from remote side.
     * @private
     */

  }, {
    key: "_dataReceivedHandler",
    value: function _dataReceivedHandler(id) {
      if (!this._sendDataPromises.has(id)) {
        _logger.default.warning('Received unknown data received message. ID: ' + id);

        return;
      } else {
        this._sendDataPromises.get(id).resolve();
      }
    }
    /**
     * @function _sdpHandler
     * @desc Handle SDP received event from remote side.
     * @private
     */

  }, {
    key: "_sdpHandler",
    value: function _sdpHandler(sdp) {
      if (sdp.type === 'offer') {
        this._onOffer(sdp);
      } else if (sdp.type === 'answer') {
        this._onAnswer(sdp);
      } else if (sdp.type === 'candidates') {
        this._onRemoteIceCandidate(sdp);
      }
    }
    /**
     * @function _trackSourcesHandler
     * @desc Received track source information from remote side.
     * @private
     */

  }, {
    key: "_trackSourcesHandler",
    value: function _trackSourcesHandler(data) {
      var _iteratorNormalCompletion4 = true;
      var _didIteratorError4 = false;
      var _iteratorError4 = undefined;

      try {
        for (var _iterator4 = data[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
          var info = _step4.value;

          this._remoteTrackSourceInfo.set(info.id, info.source);
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion4 && _iterator4.return != null) {
            _iterator4.return();
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }
    }
    /**
     * @function _streamInfoHandler
     * @desc Received stream information from remote side.
     * @private
     */

  }, {
    key: "_streamInfoHandler",
    value: function _streamInfoHandler(data) {
      if (!data) {
        _logger.default.warning('Unexpected stream info.');

        return;
      }

      this._remoteStreamInfo.set(data.id, {
        source: data.source,
        attributes: data.attributes,
        stream: null,
        mediaStream: null,
        trackIds: data.tracks // Track IDs may not match at sender and receiver sides. Keep it for legacy porposes.

      });
    }
    /**
     * @function _chatClosedHandler
     * @desc Received chat closed event from remote side.
     * @private
     */

  }, {
    key: "_chatClosedHandler",
    value: function _chatClosedHandler(data) {
      this._disposed = true;

      this._stop(data, false);
    }
  }, {
    key: "_onOffer",
    value: function _onOffer(sdp) {
      var _this8 = this;

      _logger.default.debug('About to set remote description. Signaling state: ' + this._pc.signalingState);

      sdp.sdp = this._setRtpSenderOptions(sdp.sdp, this._config); // Firefox only has one codec in answer, which does not truly reflect its
      // decoding capability. So we set codec preference to remote offer, and let
      // Firefox choose its preferred codec.
      // Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=814227.

      if (Utils.isFirefox()) {
        sdp.sdp = this._setCodecOrder(sdp.sdp);
      }

      var sessionDescription = new RTCSessionDescription(sdp);

      this._pc.setRemoteDescription(sessionDescription).then(function () {
        _this8._createAndSendAnswer();
      }, function (error) {
        _logger.default.debug('Set remote description failed. Message: ' + error.message);

        _this8._stop(error, true);
      });
    }
  }, {
    key: "_onAnswer",
    value: function _onAnswer(sdp) {
      var _this9 = this;

      _logger.default.debug('About to set remote description. Signaling state: ' + this._pc.signalingState);

      sdp.sdp = this._setRtpSenderOptions(sdp.sdp, this._config);
      var sessionDescription = new RTCSessionDescription(sdp);

      this._pc.setRemoteDescription(new RTCSessionDescription(sessionDescription)).then(function () {
        _logger.default.debug('Set remote descripiton successfully.');

        _this9._drainPendingMessages();
      }, function (error) {
        _logger.default.debug('Set remote description failed. Message: ' + error.message);

        _this9._stop(error, true);
      });
    }
  }, {
    key: "_onLocalIceCandidate",
    value: function _onLocalIceCandidate(event) {
      if (event.candidate) {
        this._sendSdp({
          type: 'candidates',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        }).catch(function (e) {
          _logger.default.warning('Failed to send candidate.');
        });
      } else {
        _logger.default.debug('Empty candidate.');
      }
    }
  }, {
    key: "_onRemoteTrackAdded",
    value: function _onRemoteTrackAdded(event) {
      _logger.default.debug('Remote track added.');

      var _iteratorNormalCompletion5 = true;
      var _didIteratorError5 = false;
      var _iteratorError5 = undefined;

      try {
        for (var _iterator5 = event.streams[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
          var stream = _step5.value;

          if (!this._remoteStreamInfo.has(stream.id)) {
            _logger.default.warning('Missing stream info.');

            return;
          }

          if (!this._remoteStreamInfo.get(stream.id).stream) {
            this._setStreamToRemoteStreamInfo(stream);
          }
        }
      } catch (err) {
        _didIteratorError5 = true;
        _iteratorError5 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion5 && _iterator5.return != null) {
            _iterator5.return();
          }
        } finally {
          if (_didIteratorError5) {
            throw _iteratorError5;
          }
        }
      }

      if (this._pc.iceConnectionState === 'connected' || this._pc.iceConnectionState === 'completed') {
        this._checkIceConnectionStateAndFireEvent();
      } else {
        this._addedTrackIds.concat(event.track.id);
      }
    }
  }, {
    key: "_onRemoteStreamAdded",
    value: function _onRemoteStreamAdded(event) {
      _logger.default.debug('Remote stream added.');

      if (!this._remoteStreamInfo.has(event.stream.id)) {
        _logger.default.warning('Cannot find source info for stream ' + event.stream.id);

        return;
      }

      if (this._pc.iceConnectionState === 'connected' || this._pc.iceConnectionState === 'completed') {
        this._sendSignalingMessage(SignalingType.TRACKS_ADDED, this._remoteStreamInfo.get(event.stream.id).trackIds);
      } else {
        this._addedTrackIds = this._addedTrackIds.concat(this._remoteStreamInfo.get(event.stream.id).trackIds);
      }

      var audioTrackSource = this._remoteStreamInfo.get(event.stream.id).source.audio;

      var videoTrackSource = this._remoteStreamInfo.get(event.stream.id).source.video;

      var sourceInfo = new StreamModule.StreamSourceInfo(audioTrackSource, videoTrackSource);

      if (Utils.isSafari()) {
        if (!sourceInfo.audio) {
          event.stream.getAudioTracks().forEach(function (track) {
            event.stream.removeTrack(track);
          });
        }

        if (!sourceInfo.video) {
          event.stream.getVideoTracks().forEach(function (track) {
            event.stream.removeTrack(track);
          });
        }
      }

      var attributes = this._remoteStreamInfo.get(event.stream.id).attributes;

      var stream = new StreamModule.RemoteStream(undefined, this._remoteId, event.stream, sourceInfo, attributes);

      if (stream) {
        this._remoteStreams.push(stream);

        var streamEvent = new StreamModule.StreamEvent('streamadded', {
          stream: stream
        });
        this.dispatchEvent(streamEvent);
      }
    }
  }, {
    key: "_onRemoteStreamRemoved",
    value: function _onRemoteStreamRemoved(event) {
      _logger.default.debug('Remote stream removed.');

      var i = this._remoteStreams.findIndex(function (s) {
        return s.mediaStream.id === event.stream.id;
      });

      if (i !== -1) {
        var stream = this._remoteStreams[i];

        this._streamRemoved(stream);

        this._remoteStreams.splice(i, 1);
      }
    }
  }, {
    key: "_onNegotiationneeded",
    value: function _onNegotiationneeded() {
      // This is intented to be executed when onnegotiationneeded event is fired.
      // However, onnegotiationneeded may fire mutiple times when more than one
      // track is added/removed. So we manually execute this function after
      // adding/removing track and creating data channel.
      _logger.default.debug('On negotiation needed.');

      if (this._pc.signalingState === 'stable') {
        this._doNegotiate();
      } else {
        this._isNegotiationNeeded = true;
      }
    }
  }, {
    key: "_onRemoteIceCandidate",
    value: function _onRemoteIceCandidate(candidateInfo) {
      var candidate = new RTCIceCandidate({
        candidate: candidateInfo.candidate,
        sdpMid: candidateInfo.sdpMid,
        sdpMLineIndex: candidateInfo.sdpMLineIndex
      });

      if (this._pc.remoteDescription && this._pc.remoteDescription.sdp !== '') {
        _logger.default.debug('Add remote ice candidates.');

        this._pc.addIceCandidate(candidate).catch(function (error) {
          _logger.default.warning('Error processing ICE candidate: ' + error);
        });
      } else {
        _logger.default.debug('Cache remote ice candidates.');

        this._remoteIceCandidates.push(candidate);
      }
    }
  }, {
    key: "_onSignalingStateChange",
    value: function _onSignalingStateChange(event) {
      _logger.default.debug('Signaling state changed: ' + this._pc.signalingState);

      if (this._pc.signalingState === 'closed') {// stopChatLocally(peer, peer.id);
      } else if (this._pc.signalingState === 'stable') {
        this._negotiating = false;

        if (this._isNegotiationNeeded) {
          this._onNegotiationneeded();
        } else {
          this._drainPendingStreams();

          this._drainPendingMessages();
        }
      } else if (this._pc.signalingState === 'have-remote-offer') {
        this._drainPendingRemoteIceCandidates();
      }
    }
  }, {
    key: "_onIceConnectionStateChange",
    value: function _onIceConnectionStateChange(event) {
      if (event.currentTarget.iceConnectionState === 'closed' || event.currentTarget.iceConnectionState === 'failed') {
        var _error = new ErrorModule.P2PError(ErrorModule.errors.P2P_WEBRTC_UNKNOWN, 'ICE connection failed or closed.');

        this._stop(_error, true);
      } else if (event.currentTarget.iceConnectionState === 'connected' || event.currentTarget.iceConnectionState === 'completed') {
        this._sendSignalingMessage(SignalingType.TRACKS_ADDED, this._addedTrackIds);

        this._addedTrackIds = [];

        this._checkIceConnectionStateAndFireEvent();
      }
    }
  }, {
    key: "_onDataChannelMessage",
    value: function _onDataChannelMessage(event) {
      var message = JSON.parse(event.data);

      _logger.default.debug('Data channel message received: ' + message.data);

      this._sendSignalingMessage(SignalingType.DATA_RECEIVED, message.id);

      var messageEvent = new _event.MessageEvent('messagereceived', {
        message: message.data,
        origin: this._remoteId
      });
      this.dispatchEvent(messageEvent);
    }
  }, {
    key: "_onDataChannelOpen",
    value: function _onDataChannelOpen(event) {
      _logger.default.debug('Data Channel is opened.');

      if (event.target.label === DataChannelLabel.MESSAGE) {
        _logger.default.debug('Data channel for messages is opened.');

        this._drainPendingMessages();
      }
    }
  }, {
    key: "_onDataChannelClose",
    value: function _onDataChannelClose(event) {
      _logger.default.debug('Data Channel is closed.');
    }
  }, {
    key: "_streamRemoved",
    value: function _streamRemoved(stream) {
      if (!this._remoteStreamInfo.has(stream.mediaStream.id)) {
        _logger.default.warning('Cannot find stream info.');
      }

      this._sendSignalingMessage(SignalingType.TRACKS_REMOVED, this._remoteStreamInfo.get(stream.mediaStream.id).trackIds);

      var event = new _event.OwtEvent('ended');
      stream.dispatchEvent(event);
    }
  }, {
    key: "_isUnifiedPlan",
    value: function _isUnifiedPlan() {
      if (Utils.isFirefox()) {
        return true;
      }

      var pc = new RTCPeerConnection({
        sdpSemantics: 'unified-plan'
      });
      return pc.getConfiguration() && pc.getConfiguration().sdpSemantics === 'plan-b';
    }
  }, {
    key: "_createPeerConnection",
    value: function _createPeerConnection() {
      var _this10 = this;

      var pcConfiguration = this._config.rtcConfiguration || {};

      if (Utils.isChrome()) {
        pcConfiguration.sdpSemantics = 'unified-plan';
      }

      this._pc = new RTCPeerConnection(pcConfiguration); // Firefox 59 implemented addTransceiver. However, mid in SDP will differ from track's ID in this case. And transceiver's mid is null.

      if (typeof this._pc.addTransceiver === 'function' && Utils.isSafari()) {
        this._pc.addTransceiver('audio');

        this._pc.addTransceiver('video');
      }

      console.log("window.navigator.userAgent----->", window.navigator.userAgent);
      console.log("Utils.isSafari()----->", Utils.isSafari());

      if (!this._isUnifiedPlan() && !Utils.isSafari() && !Utils.isTauri()) {
        this._pc.onaddstream = function (event) {
          // TODO: Legacy API, should be removed when all UAs implemented WebRTC 1.0.
          _this10._onRemoteStreamAdded.apply(_this10, [event]);
        };

        this._pc.onremovestream = function (event) {
          _this10._onRemoteStreamRemoved.apply(_this10, [event]);
        };
      } else {
        this._pc.ontrack = function (event) {
          _this10._onRemoteTrackAdded.apply(_this10, [event]);
        };
      }

      this._pc.onicecandidate = function (event) {
        _this10._onLocalIceCandidate.apply(_this10, [event]);
      };

      this._pc.onsignalingstatechange = function (event) {
        _this10._onSignalingStateChange.apply(_this10, [event]);
      };

      this._pc.ondatachannel = function (event) {
        _logger.default.debug('On data channel.'); // Save remote created data channel.


        if (!_this10._dataChannels.has(event.channel.label)) {
          _this10._dataChannels.set(event.channel.label, event.channel);

          _logger.default.debug('Save remote created data channel.');
        }

        _this10._bindEventsToDataChannel(event.channel);
      };

      this._pc.oniceconnectionstatechange = function (event) {
        _this10._onIceConnectionStateChange.apply(_this10, [event]);
      };
      /*
      this._pc.oniceChannelStatechange = function(event) {
        _onIceChannelStateChange(peer, event);
      };
       = function() {
        onNegotiationneeded(peers[peer.id]);
      };
       //DataChannel
      this._pc.ondatachannel = function(event) {
        Logger.debug(myId + ': On data channel');
        // Save remote created data channel.
        if (!peer.dataChannels[event.channel.label]) {
          peer.dataChannels[event.channel.label] = event.channel;
          Logger.debug('Save remote created data channel.');
        }
        bindEventsToDataChannel(event.channel, peer);
      };*/

    }
  }, {
    key: "_drainPendingStreams",
    value: function _drainPendingStreams() {
      var negotiationNeeded = false;

      _logger.default.debug('Draining pending streams.');

      if (this._pc && this._pc.signalingState === 'stable') {
        _logger.default.debug('Peer connection is ready for draining pending streams.');

        for (var i = 0; i < this._pendingStreams.length; i++) {
          var stream = this._pendingStreams[i]; // OnNegotiationNeeded event will be triggered immediately after adding stream to PeerConnection in Firefox.
          // And OnNegotiationNeeded handler will execute drainPendingStreams. To avoid add the same stream multiple times,
          // shift it from pending stream list before adding it to PeerConnection.

          this._pendingStreams.shift();

          if (!stream.mediaStream) {
            continue;
          }

          var _iteratorNormalCompletion6 = true;
          var _didIteratorError6 = false;
          var _iteratorError6 = undefined;

          try {
            for (var _iterator6 = stream.mediaStream.getTracks()[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
              var track = _step6.value;

              this._pc.addTrack(track, stream.mediaStream);

              negotiationNeeded = true;
            }
          } catch (err) {
            _didIteratorError6 = true;
            _iteratorError6 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion6 && _iterator6.return != null) {
                _iterator6.return();
              }
            } finally {
              if (_didIteratorError6) {
                throw _iteratorError6;
              }
            }
          }

          _logger.default.debug('Added stream to peer connection.');

          this._publishingStreams.push(stream);
        }

        this._pendingStreams.length = 0;

        for (var j = 0; j < this._pendingUnpublishStreams.length; j++) {
          if (!this._pendingUnpublishStreams[j].mediaStream) {
            continue;
          }

          if ('removeStream' in this._pc) {
            this._pc.removeStream(this._pendingUnpublishStreams[j].mediaStream);
          }

          negotiationNeeded = true;

          this._unpublishPromises.get(this._pendingUnpublishStreams[j].mediaStream.id).resolve();

          this._publishedStreams.delete(this._pendingUnpublishStreams[j]);

          _logger.default.debug('Remove stream.');
        }

        this._pendingUnpublishStreams.length = 0;
      }

      if (negotiationNeeded) {
        this._onNegotiationneeded();
      }
    }
  }, {
    key: "_drainPendingRemoteIceCandidates",
    value: function _drainPendingRemoteIceCandidates() {
      for (var i = 0; i < this._remoteIceCandidates.length; i++) {
        _logger.default.debug('Add candidate');

        this._pc.addIceCandidate(this._remoteIceCandidates[i]).catch(function (error) {
          _logger.default.warning('Error processing ICE candidate: ' + error);
        });
      }

      this._remoteIceCandidates.length = 0;
    }
  }, {
    key: "_drainPendingMessages",
    value: function _drainPendingMessages() {
      _logger.default.debug('Draining pending messages.');

      if (this._pendingMessages.length == 0) {
        return;
      }

      var dc = this._dataChannels.get(DataChannelLabel.MESSAGE);

      if (dc && dc.readyState === 'open') {
        for (var i = 0; i < this._pendingMessages.length; i++) {
          _logger.default.debug('Sending message via data channel: ' + this._pendingMessages[i]);

          dc.send(JSON.stringify(this._pendingMessages[i]));
        }

        this._pendingMessages.length = 0;
      } else if (this._pc && !dc) {
        this._createDataChannel(DataChannelLabel.MESSAGE);
      }
    }
  }, {
    key: "_sendStreamInfo",
    value: function _sendStreamInfo(stream) {
      if (!stream || !stream.mediaStream) {
        return new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_ILLEGAL_ARGUMENT);
      }

      var info = [];
      stream.mediaStream.getTracks().map(function (track) {
        info.push({
          id: track.id,
          source: stream.source[track.kind]
        });
      });
      return Promise.all([this._sendSignalingMessage(SignalingType.TRACK_SOURCES, info), this._sendSignalingMessage(SignalingType.STREAM_INFO, {
        id: stream.mediaStream.id,
        attributes: stream.attributes,
        // Track IDs may not match at sender and receiver sides.
        tracks: Array.from(info, function (item) {
          return item.id;
        }),
        // This is a workaround for Safari. Please use track-sources if possible.
        source: stream.source
      })]);
    }
  }, {
    key: "_sendSysInfoIfNecessary",
    value: function _sendSysInfoIfNecessary() {
      if (this._infoSent) {
        return Promise.resolve();
      }

      this._infoSent = true;
      return this._sendSignalingMessage(SignalingType.UA, sysInfo);
    }
  }, {
    key: "_sendClosedMsgIfNecessary",
    value: function _sendClosedMsgIfNecessary() {
      if (this._pc.remoteDescription === null || this._pc.remoteDescription.sdp === '') {
        return this._sendSignalingMessage(SignalingType.CLOSED);
      }

      return Promise.resolve();
    }
  }, {
    key: "_handleRemoteCapability",
    value: function _handleRemoteCapability(ua) {
      if (ua.sdk && ua.sdk && ua.sdk.type === 'JavaScript' && ua.runtime && ua.runtime.name === 'Firefox') {
        this._remoteSideSupportsRemoveStream = false;
        this._remoteSideSupportsPlanB = false;
        this._remoteSideSupportsUnifiedPlan = true;
      } else {
        // Remote side is iOS/Android/C++ which uses Google's WebRTC stack.
        this._remoteSideSupportsRemoveStream = true;
        this._remoteSideSupportsPlanB = true;
        this._remoteSideSupportsUnifiedPlan = false;
      }
    }
  }, {
    key: "_doNegotiate",
    value: function _doNegotiate() {
      this._createAndSendOffer();
    }
  }, {
    key: "_setCodecOrder",
    value: function _setCodecOrder(sdp) {
      if (this._config.audioEncodings) {
        var audioCodecNames = Array.from(this._config.audioEncodings, function (encodingParameters) {
          return encodingParameters.codec.name;
        });
        sdp = SdpUtils.reorderCodecs(sdp, 'audio', audioCodecNames);
      }

      if (this._config.videoEncodings) {
        var videoCodecNames = Array.from(this._config.videoEncodings, function (encodingParameters) {
          return encodingParameters.codec.name;
        });
        sdp = SdpUtils.reorderCodecs(sdp, 'video', videoCodecNames);
      }

      return sdp;
    }
  }, {
    key: "_setMaxBitrate",
    value: function _setMaxBitrate(sdp, options) {
      if (_typeof(options.audioEncodings) === 'object') {
        sdp = SdpUtils.setMaxBitrate(sdp, options.audioEncodings);
      }

      if (_typeof(options.videoEncodings) === 'object') {
        sdp = SdpUtils.setMaxBitrate(sdp, options.videoEncodings);
      }

      return sdp;
    }
  }, {
    key: "_setRtpSenderOptions",
    value: function _setRtpSenderOptions(sdp, options) {
      sdp = this._setMaxBitrate(sdp, options);
      return sdp;
    }
  }, {
    key: "_setRtpReceiverOptions",
    value: function _setRtpReceiverOptions(sdp) {
      sdp = this._setCodecOrder(sdp);
      return sdp;
    }
  }, {
    key: "_createAndSendOffer",
    value: function _createAndSendOffer() {
      var _this11 = this;

      if (!this._pc) {
        _logger.default.error('Peer connection have not been created.');

        return;
      }

      this._isNegotiationNeeded = false;
      this._isCaller = true;
      var localDesc;

      this._pc.createOffer().then(function (desc) {
        desc.sdp = _this11._setRtpReceiverOptions(desc.sdp);
        localDesc = desc;

        if (_this11._pc.signalingState === 'stable') {
          return _this11._pc.setLocalDescription(desc).then(function () {
            return _this11._sendSdp(localDesc);
          });
        }
      }).catch(function (e) {
        _logger.default.error(e.message + ' Please check your codec settings.');

        var error = new ErrorModule.P2PError(ErrorModule.errors.P2P_WEBRTC_SDP, e.message);

        _this11._stop(error, true);
      });
    }
  }, {
    key: "_createAndSendAnswer",
    value: function _createAndSendAnswer() {
      var _this12 = this;

      this._drainPendingStreams();

      this._isNegotiationNeeded = false;
      this._isCaller = false;
      var localDesc;

      this._pc.createAnswer().then(function (desc) {
        desc.sdp = _this12._setRtpReceiverOptions(desc.sdp);
        localDesc = desc;

        _this12._logCurrentAndPendingLocalDescription();

        return _this12._pc.setLocalDescription(desc);
      }).then(function () {
        return _this12._sendSdp(localDesc);
      }).catch(function (e) {
        _logger.default.error(e.message + ' Please check your codec settings.');

        var error = new ErrorModule.P2PError(ErrorModule.errors.P2P_WEBRTC_SDP, e.message);

        _this12._stop(error, true);
      });
    }
  }, {
    key: "_logCurrentAndPendingLocalDescription",
    value: function _logCurrentAndPendingLocalDescription() {
      _logger.default.info('Current description: ' + this._pc.currentLocalDescription);

      _logger.default.info('Pending description: ' + this._pc.pendingLocalDescription);
    }
  }, {
    key: "_getAndDeleteTrackSourceInfo",
    value: function _getAndDeleteTrackSourceInfo(tracks) {
      if (tracks.length > 0) {
        var trackId = tracks[0].id;

        if (this._remoteTrackSourceInfo.has(trackId)) {
          var sourceInfo = this._remoteTrackSourceInfo.get(trackId);

          this._remoteTrackSourceInfo.delete(trackId);

          return sourceInfo;
        } else {
          _logger.default.warning('Cannot find source info for ' + trackId);
        }
      }
    }
  }, {
    key: "_unpublish",
    value: function _unpublish(stream) {
      var _this13 = this;

      if (navigator.mozGetUserMedia || !this._remoteSideSupportsRemoveStream) {
        // Actually unpublish is supported. It is a little bit complex since Firefox implemented WebRTC spec while Chrome implemented an old API.
        _logger.default.error('Stopping a publication is not supported on Firefox. Please use P2PClient.stop() to stop the connection with remote endpoint.');

        return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_UNSUPPORTED_METHOD));
      }

      if (!this._publishedStreams.has(stream)) {
        return Promise.reject(new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_ILLEGAL_ARGUMENT));
      }

      this._pendingUnpublishStreams.push(stream);

      return new Promise(function (resolve, reject) {
        _this13._unpublishPromises.set(stream.mediaStream.id, {
          resolve: resolve,
          reject: reject
        });

        _this13._drainPendingStreams();
      });
    } // Make sure |_pc| is available before calling this method.

  }, {
    key: "_createDataChannel",
    value: function _createDataChannel(label) {
      if (this._dataChannels.has(label)) {
        _logger.default.warning('Data channel labeled ' + label + ' already exists.');

        return;
      }

      if (!this._pc) {
        _logger.default.debug('PeerConnection is not available before creating DataChannel.');

        return;
      }

      _logger.default.debug('Create data channel.');

      var dc = this._pc.createDataChannel(label);

      this._bindEventsToDataChannel(dc);

      this._dataChannels.set(DataChannelLabel.MESSAGE, dc);

      this._onNegotiationneeded();
    }
  }, {
    key: "_bindEventsToDataChannel",
    value: function _bindEventsToDataChannel(dc) {
      var _this14 = this;

      dc.onmessage = function (event) {
        _this14._onDataChannelMessage.apply(_this14, [event]);
      };

      dc.onopen = function (event) {
        _this14._onDataChannelOpen.apply(_this14, [event]);
      };

      dc.onclose = function (event) {
        _this14._onDataChannelClose.apply(_this14, [event]);
      };

      dc.onerror = function (event) {
        _logger.default.debug('Data Channel Error:', error);
      };
    } // Returns all MediaStreams it belongs to.

  }, {
    key: "_getStreamByTrack",
    value: function _getStreamByTrack(mediaStreamTrack) {
      var streams = [];
      var _iteratorNormalCompletion7 = true;
      var _didIteratorError7 = false;
      var _iteratorError7 = undefined;

      try {
        for (var _iterator7 = this._remoteStreamInfo[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
          var _step7$value = _slicedToArray(_step7.value, 2),
              id = _step7$value[0],
              info = _step7$value[1];

          if (!info.stream || !info.stream.mediaStream) {
            continue;
          }

          var _iteratorNormalCompletion8 = true;
          var _didIteratorError8 = false;
          var _iteratorError8 = undefined;

          try {
            for (var _iterator8 = info.stream.mediaStream.getTracks()[Symbol.iterator](), _step8; !(_iteratorNormalCompletion8 = (_step8 = _iterator8.next()).done); _iteratorNormalCompletion8 = true) {
              var track = _step8.value;

              if (mediaStreamTrack === track) {
                streams.push(info.stream.mediaStream);
              }
            }
          } catch (err) {
            _didIteratorError8 = true;
            _iteratorError8 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion8 && _iterator8.return != null) {
                _iterator8.return();
              }
            } finally {
              if (_didIteratorError8) {
                throw _iteratorError8;
              }
            }
          }
        }
      } catch (err) {
        _didIteratorError7 = true;
        _iteratorError7 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion7 && _iterator7.return != null) {
            _iterator7.return();
          }
        } finally {
          if (_didIteratorError7) {
            throw _iteratorError7;
          }
        }
      }

      return streams;
    }
  }, {
    key: "_areAllTracksEnded",
    value: function _areAllTracksEnded(mediaStream) {
      var _iteratorNormalCompletion9 = true;
      var _didIteratorError9 = false;
      var _iteratorError9 = undefined;

      try {
        for (var _iterator9 = mediaStream.getTracks()[Symbol.iterator](), _step9; !(_iteratorNormalCompletion9 = (_step9 = _iterator9.next()).done); _iteratorNormalCompletion9 = true) {
          var track = _step9.value;

          if (track.readyState === 'live') {
            return false;
          }
        }
      } catch (err) {
        _didIteratorError9 = true;
        _iteratorError9 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion9 && _iterator9.return != null) {
            _iterator9.return();
          }
        } finally {
          if (_didIteratorError9) {
            throw _iteratorError9;
          }
        }
      }

      return true;
    }
  }, {
    key: "_stop",
    value: function _stop(error, notifyRemote) {
      var promiseError = error;

      if (!promiseError) {
        promiseError = new ErrorModule.P2PError(ErrorModule.errors.P2P_CLIENT_UNKNOWN);
      }

      var _iteratorNormalCompletion10 = true;
      var _didIteratorError10 = false;
      var _iteratorError10 = undefined;

      try {
        for (var _iterator10 = this._dataChannels[Symbol.iterator](), _step10; !(_iteratorNormalCompletion10 = (_step10 = _iterator10.next()).done); _iteratorNormalCompletion10 = true) {
          var _step10$value = _slicedToArray(_step10.value, 2),
              label = _step10$value[0],
              dc = _step10$value[1];

          dc.close();
        }
      } catch (err) {
        _didIteratorError10 = true;
        _iteratorError10 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion10 && _iterator10.return != null) {
            _iterator10.return();
          }
        } finally {
          if (_didIteratorError10) {
            throw _iteratorError10;
          }
        }
      }

      this._dataChannels.clear();

      if (this._pc && this._pc.iceConnectionState !== 'closed') {
        this._pc.close();
      }

      var _iteratorNormalCompletion11 = true;
      var _didIteratorError11 = false;
      var _iteratorError11 = undefined;

      try {
        for (var _iterator11 = this._publishPromises[Symbol.iterator](), _step11; !(_iteratorNormalCompletion11 = (_step11 = _iterator11.next()).done); _iteratorNormalCompletion11 = true) {
          var _step11$value = _slicedToArray(_step11.value, 2),
              id = _step11$value[0],
              promise = _step11$value[1];

          promise.reject(promiseError);
        }
      } catch (err) {
        _didIteratorError11 = true;
        _iteratorError11 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion11 && _iterator11.return != null) {
            _iterator11.return();
          }
        } finally {
          if (_didIteratorError11) {
            throw _iteratorError11;
          }
        }
      }

      this._publishPromises.clear();

      var _iteratorNormalCompletion12 = true;
      var _didIteratorError12 = false;
      var _iteratorError12 = undefined;

      try {
        for (var _iterator12 = this._unpublishPromises[Symbol.iterator](), _step12; !(_iteratorNormalCompletion12 = (_step12 = _iterator12.next()).done); _iteratorNormalCompletion12 = true) {
          var _step12$value = _slicedToArray(_step12.value, 2),
              id = _step12$value[0],
              promise = _step12$value[1];

          promise.reject(promiseError);
        }
      } catch (err) {
        _didIteratorError12 = true;
        _iteratorError12 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion12 && _iterator12.return != null) {
            _iterator12.return();
          }
        } finally {
          if (_didIteratorError12) {
            throw _iteratorError12;
          }
        }
      }

      this._unpublishPromises.clear();

      var _iteratorNormalCompletion13 = true;
      var _didIteratorError13 = false;
      var _iteratorError13 = undefined;

      try {
        for (var _iterator13 = this._sendDataPromises[Symbol.iterator](), _step13; !(_iteratorNormalCompletion13 = (_step13 = _iterator13.next()).done); _iteratorNormalCompletion13 = true) {
          var _step13$value = _slicedToArray(_step13.value, 2),
              id = _step13$value[0],
              promise = _step13$value[1];

          promise.reject(promiseError);
        }
      } catch (err) {
        _didIteratorError13 = true;
        _iteratorError13 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion13 && _iterator13.return != null) {
            _iterator13.return();
          }
        } finally {
          if (_didIteratorError13) {
            throw _iteratorError13;
          }
        }
      }

      this._sendDataPromises.clear(); // Fire ended event if publication or remote stream exists.


      this._publishedStreams.forEach(function (publication) {
        publication.dispatchEvent(new _event.OwtEvent('ended'));
      });

      this._publishedStreams.clear();

      this._remoteStreams.forEach(function (stream) {
        stream.dispatchEvent(new _event.OwtEvent('ended'));
      });

      this._remoteStreams = [];

      if (!this._disposed) {
        if (notifyRemote) {
          var sendError;

          if (error) {
            sendError = JSON.parse(JSON.stringify(error)); // Avoid to leak detailed error to remote side.

            sendError.message = 'Error happened at remote side.';
          }

          this._sendSignalingMessage(SignalingType.CLOSED, sendError).catch(function (err) {
            _logger.default.debug('Failed to send close.' + err.message);
          });
        }

        this.dispatchEvent(new Event('ended'));
      }
    }
  }, {
    key: "_setStreamToRemoteStreamInfo",
    value: function _setStreamToRemoteStreamInfo(mediaStream) {
      var info = this._remoteStreamInfo.get(mediaStream.id);

      var attributes = info.attributes;
      var sourceInfo = new StreamModule.StreamSourceInfo(this._remoteStreamInfo.get(mediaStream.id).source.audio, this._remoteStreamInfo.get(mediaStream.id).source.video);
      info.stream = new StreamModule.RemoteStream(undefined, this._remoteId, mediaStream, sourceInfo, attributes);
      info.mediaStream = mediaStream;
      var stream = info.stream;

      if (stream) {
        this._remoteStreams.push(stream);
      } else {
        _logger.default.warning('Failed to create RemoteStream.');
      }
    }
  }, {
    key: "_checkIceConnectionStateAndFireEvent",
    value: function _checkIceConnectionStateAndFireEvent() {
      var _this15 = this;

      console.log("_checkIceConnectionStateAndFireEvent------------->");

      if (this._pc.iceConnectionState === 'connected' || this._pc.iceConnectionState === 'completed') {
        var _iteratorNormalCompletion14 = true;
        var _didIteratorError14 = false;
        var _iteratorError14 = undefined;

        try {
          for (var _iterator14 = this._remoteStreamInfo[Symbol.iterator](), _step14; !(_iteratorNormalCompletion14 = (_step14 = _iterator14.next()).done); _iteratorNormalCompletion14 = true) {
            var _step14$value = _slicedToArray(_step14.value, 2),
                id = _step14$value[0],
                info = _step14$value[1];

            if (info.mediaStream) {
              var streamEvent = new StreamModule.StreamEvent('streamadded', {
                stream: info.stream
              });

              if (this._isUnifiedPlan()) {
                var _iteratorNormalCompletion15 = true;
                var _didIteratorError15 = false;
                var _iteratorError15 = undefined;

                try {
                  for (var _iterator15 = info.mediaStream.getTracks()[Symbol.iterator](), _step15; !(_iteratorNormalCompletion15 = (_step15 = _iterator15.next()).done); _iteratorNormalCompletion15 = true) {
                    var track = _step15.value;
                    track.addEventListener('ended', function (event) {
                      var mediaStreams = _this15._getStreamByTrack(event.target);

                      var _iteratorNormalCompletion16 = true;
                      var _didIteratorError16 = false;
                      var _iteratorError16 = undefined;

                      try {
                        for (var _iterator16 = mediaStreams[Symbol.iterator](), _step16; !(_iteratorNormalCompletion16 = (_step16 = _iterator16.next()).done); _iteratorNormalCompletion16 = true) {
                          var mediaStream = _step16.value;

                          if (_this15._areAllTracksEnded(mediaStream)) {
                            _this15._onRemoteStreamRemoved(mediaStream);
                          }
                        }
                      } catch (err) {
                        _didIteratorError16 = true;
                        _iteratorError16 = err;
                      } finally {
                        try {
                          if (!_iteratorNormalCompletion16 && _iterator16.return != null) {
                            _iterator16.return();
                          }
                        } finally {
                          if (_didIteratorError16) {
                            throw _iteratorError16;
                          }
                        }
                      }
                    });
                  }
                } catch (err) {
                  _didIteratorError15 = true;
                  _iteratorError15 = err;
                } finally {
                  try {
                    if (!_iteratorNormalCompletion15 && _iterator15.return != null) {
                      _iterator15.return();
                    }
                  } finally {
                    if (_didIteratorError15) {
                      throw _iteratorError15;
                    }
                  }
                }
              }

              this._sendSignalingMessage(SignalingType.TRACKS_ADDED, info.trackIds);

              this._remoteStreamInfo.get(info.mediaStream.id).mediaStream = null;
              this.dispatchEvent(streamEvent);
            }
          }
        } catch (err) {
          _didIteratorError14 = true;
          _iteratorError14 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion14 && _iterator14.return != null) {
              _iterator14.return();
            }
          } finally {
            if (_didIteratorError14) {
              throw _iteratorError14;
            }
          }
        }
      }
    }
  }]);

  return P2PPeerConnectionChannel;
}(_event.EventDispatcher);

var _default = P2PPeerConnectionChannel;
exports.default = _default;

},{"../base/event.js":3,"../base/logger.js":5,"../base/publication.js":8,"../base/sdputils.js":9,"../base/stream.js":10,"../base/utils.js":11,"./error.js":23}]},{},[22])(22)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvc2RrL2Jhc2UvYmFzZTY0LmpzIiwic3JjL3Nkay9iYXNlL2NvZGVjLmpzIiwic3JjL3Nkay9iYXNlL2V2ZW50LmpzIiwic3JjL3Nkay9iYXNlL2V4cG9ydC5qcyIsInNyYy9zZGsvYmFzZS9sb2dnZXIuanMiLCJzcmMvc2RrL2Jhc2UvbWVkaWFmb3JtYXQuanMiLCJzcmMvc2RrL2Jhc2UvbWVkaWFzdHJlYW0tZmFjdG9yeS5qcyIsInNyYy9zZGsvYmFzZS9wdWJsaWNhdGlvbi5qcyIsInNyYy9zZGsvYmFzZS9zZHB1dGlscy5qcyIsInNyYy9zZGsvYmFzZS9zdHJlYW0uanMiLCJzcmMvc2RrL2Jhc2UvdXRpbHMuanMiLCJzcmMvc2RrL2NvbmZlcmVuY2UvY2hhbm5lbC5qcyIsInNyYy9zZGsvY29uZmVyZW5jZS9jbGllbnQuanMiLCJzcmMvc2RrL2NvbmZlcmVuY2UvZXJyb3IuanMiLCJzcmMvc2RrL2NvbmZlcmVuY2UvZXhwb3J0LmpzIiwic3JjL3Nkay9jb25mZXJlbmNlL2luZm8uanMiLCJzcmMvc2RrL2NvbmZlcmVuY2UvbWl4ZWRzdHJlYW0uanMiLCJzcmMvc2RrL2NvbmZlcmVuY2UvcGFydGljaXBhbnQuanMiLCJzcmMvc2RrL2NvbmZlcmVuY2Uvc2lnbmFsaW5nLmpzIiwic3JjL3Nkay9jb25mZXJlbmNlL3N0cmVhbXV0aWxzLmpzIiwic3JjL3Nkay9jb25mZXJlbmNlL3N1YnNjcmlwdGlvbi5qcyIsInNyYy9zZGsvZXhwb3J0LmpzIiwic3JjL3Nkay9wMnAvZXJyb3IuanMiLCJzcmMvc2RrL3AycC9leHBvcnQuanMiLCJzcmMvc2RrL3AycC9wMnBjbGllbnQuanMiLCJzcmMvc2RrL3AycC9wZWVyY29ubmVjdGlvbi1jaGFubmVsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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LEVBQXVELElBQUksQ0FBQyxRQUE1RDs7QUFDQSxtQkFBSyxpQkFBTCxDQUF1QixHQUF2QixDQUEyQixJQUFJLENBQUMsV0FBTCxDQUFpQixFQUE1QyxFQUFnRCxXQUFoRCxHQUE4RCxJQUE5RDtBQUNBLG1CQUFLLGFBQUwsQ0FBbUIsV0FBbkI7QUFDRDtBQUNGO0FBdEI4QztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBdUJoRDtBQUNGOzs7O0VBamlDb0Msc0I7O2VBb2lDeEIsd0IiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIvLyBNSVQgTGljZW5zZVxuLy9cbi8vIENvcHlyaWdodCAoYykgMjAxMiBVbml2ZXJzaWRhZCBQb2xpdMOpY25pY2EgZGUgTWFkcmlkXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxuLy8gb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuLy8gaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xuLy8gdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuLy8gY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG4vLyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbFxuLy8gY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG4vLyBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbi8vIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuLy8gQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuLy8gTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbi8vIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFXG4vLyBTT0ZUV0FSRS5cblxuLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4vLyBUaGlzIGZpbGUgaXMgYm9ycm93ZWQgZnJvbSBseW5ja2lhL2xpY29kZSB3aXRoIHNvbWUgbW9kaWZpY2F0aW9ucy5cblxuLyogZ2xvYmFsIHVuZXNjYXBlKi9cbid1c2Ugc3RyaWN0JztcbmV4cG9ydCBjb25zdCBCYXNlNjQgPSAoZnVuY3Rpb24oKSB7XG4gIGNvbnN0IEVORF9PRl9JTlBVVCA9IC0xO1xuICBsZXQgYmFzZTY0U3RyO1xuICBsZXQgYmFzZTY0Q291bnQ7XG5cbiAgbGV0IGk7XG5cbiAgY29uc3QgYmFzZTY0Q2hhcnMgPSBbXG4gICAgJ0EnLCAnQicsICdDJywgJ0QnLCAnRScsICdGJywgJ0cnLCAnSCcsXG4gICAgJ0knLCAnSicsICdLJywgJ0wnLCAnTScsICdOJywgJ08nLCAnUCcsXG4gICAgJ1EnLCAnUicsICdTJywgJ1QnLCAnVScsICdWJywgJ1cnLCAnWCcsXG4gICAgJ1knLCAnWicsICdhJywgJ2InLCAnYycsICdkJywgJ2UnLCAnZicsXG4gICAgJ2cnLCAnaCcsICdpJywgJ2onLCAnaycsICdsJywgJ20nLCAnbicsXG4gICAgJ28nLCAncCcsICdxJywgJ3InLCAncycsICd0JywgJ3UnLCAndicsXG4gICAgJ3cnLCAneCcsICd5JywgJ3onLCAnMCcsICcxJywgJzInLCAnMycsXG4gICAgJzQnLCAnNScsICc2JywgJzcnLCAnOCcsICc5JywgJysnLCAnLycsXG4gIF07XG5cbiAgY29uc3QgcmV2ZXJzZUJhc2U2NENoYXJzID0gW107XG5cbiAgZm9yIChpID0gMDsgaSA8IGJhc2U2NENoYXJzLmxlbmd0aDsgaSA9IGkgKyAxKSB7XG4gICAgcmV2ZXJzZUJhc2U2NENoYXJzW2Jhc2U2NENoYXJzW2ldXSA9IGk7XG4gIH1cblxuICBjb25zdCBzZXRCYXNlNjRTdHIgPSBmdW5jdGlvbihzdHIpIHtcbiAgICBiYXNlNjRTdHIgPSBzdHI7XG4gICAgYmFzZTY0Q291bnQgPSAwO1xuICB9O1xuXG4gIGNvbnN0IHJlYWRCYXNlNjQgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIWJhc2U2NFN0cikge1xuICAgICAgcmV0dXJuIEVORF9PRl9JTlBVVDtcbiAgICB9XG4gICAgaWYgKGJhc2U2NENvdW50ID49IGJhc2U2NFN0ci5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBFTkRfT0ZfSU5QVVQ7XG4gICAgfVxuICAgIGNvbnN0IGMgPSBiYXNlNjRTdHIuY2hhckNvZGVBdChiYXNlNjRDb3VudCkgJiAweGZmO1xuICAgIGJhc2U2NENvdW50ID0gYmFzZTY0Q291bnQgKyAxO1xuICAgIHJldHVybiBjO1xuICB9O1xuXG4gIGNvbnN0IGVuY29kZUJhc2U2NCA9IGZ1bmN0aW9uKHN0cikge1xuICAgIGxldCByZXN1bHQ7XG4gICAgbGV0IGRvbmU7XG4gICAgc2V0QmFzZTY0U3RyKHN0cik7XG4gICAgcmVzdWx0ID0gJyc7XG4gICAgY29uc3QgaW5CdWZmZXIgPSBuZXcgQXJyYXkoMyk7XG4gICAgZG9uZSA9IGZhbHNlO1xuICAgIHdoaWxlICghZG9uZSAmJiAoaW5CdWZmZXJbMF0gPSByZWFkQmFzZTY0KCkpICE9PSBFTkRfT0ZfSU5QVVQpIHtcbiAgICAgIGluQnVmZmVyWzFdID0gcmVhZEJhc2U2NCgpO1xuICAgICAgaW5CdWZmZXJbMl0gPSByZWFkQmFzZTY0KCk7XG4gICAgICByZXN1bHQgPSByZXN1bHQgKyAoYmFzZTY0Q2hhcnNbaW5CdWZmZXJbMF0gPj4gMl0pO1xuICAgICAgaWYgKGluQnVmZmVyWzFdICE9PSBFTkRfT0ZfSU5QVVQpIHtcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0ICsgKGJhc2U2NENoYXJzWygoaW5CdWZmZXJbMF0gPDwgNCkgJiAweDMwKSB8IChcbiAgICAgICAgICBpbkJ1ZmZlclsxXSA+PiA0KV0pO1xuICAgICAgICBpZiAoaW5CdWZmZXJbMl0gIT09IEVORF9PRl9JTlBVVCkge1xuICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdCArIChiYXNlNjRDaGFyc1soKGluQnVmZmVyWzFdIDw8IDIpICYgMHgzYykgfCAoXG4gICAgICAgICAgICBpbkJ1ZmZlclsyXSA+PiA2KV0pO1xuICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdCArIChiYXNlNjRDaGFyc1tpbkJ1ZmZlclsyXSAmIDB4M0ZdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHQgPSByZXN1bHQgKyAoYmFzZTY0Q2hhcnNbKChpbkJ1ZmZlclsxXSA8PCAyKSAmIDB4M2MpXSk7XG4gICAgICAgICAgcmVzdWx0ID0gcmVzdWx0ICsgKCc9Jyk7XG4gICAgICAgICAgZG9uZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdCArIChiYXNlNjRDaGFyc1soKGluQnVmZmVyWzBdIDw8IDQpICYgMHgzMCldKTtcbiAgICAgICAgcmVzdWx0ID0gcmVzdWx0ICsgKCc9Jyk7XG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdCArICgnPScpO1xuICAgICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBjb25zdCByZWFkUmV2ZXJzZUJhc2U2NCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICghYmFzZTY0U3RyKSB7XG4gICAgICByZXR1cm4gRU5EX09GX0lOUFVUO1xuICAgIH1cbiAgICB3aGlsZSAodHJ1ZSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnN0YW50LWNvbmRpdGlvblxuICAgICAgaWYgKGJhc2U2NENvdW50ID49IGJhc2U2NFN0ci5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIEVORF9PRl9JTlBVVDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG5leHRDaGFyYWN0ZXIgPSBiYXNlNjRTdHIuY2hhckF0KGJhc2U2NENvdW50KTtcbiAgICAgIGJhc2U2NENvdW50ID0gYmFzZTY0Q291bnQgKyAxO1xuICAgICAgaWYgKHJldmVyc2VCYXNlNjRDaGFyc1tuZXh0Q2hhcmFjdGVyXSkge1xuICAgICAgICByZXR1cm4gcmV2ZXJzZUJhc2U2NENoYXJzW25leHRDaGFyYWN0ZXJdO1xuICAgICAgfVxuICAgICAgaWYgKG5leHRDaGFyYWN0ZXIgPT09ICdBJykge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgY29uc3QgbnRvcyA9IGZ1bmN0aW9uKG4pIHtcbiAgICBuID0gbi50b1N0cmluZygxNik7XG4gICAgaWYgKG4ubGVuZ3RoID09PSAxKSB7XG4gICAgICBuID0gJzAnICsgbjtcbiAgICB9XG4gICAgbiA9ICclJyArIG47XG4gICAgcmV0dXJuIHVuZXNjYXBlKG4pO1xuICB9O1xuXG4gIGNvbnN0IGRlY29kZUJhc2U2NCA9IGZ1bmN0aW9uKHN0cikge1xuICAgIGxldCByZXN1bHQ7XG4gICAgbGV0IGRvbmU7XG4gICAgc2V0QmFzZTY0U3RyKHN0cik7XG4gICAgcmVzdWx0ID0gJyc7XG4gICAgY29uc3QgaW5CdWZmZXIgPSBuZXcgQXJyYXkoNCk7XG4gICAgZG9uZSA9IGZhbHNlO1xuICAgIHdoaWxlICghZG9uZSAmJiAoaW5CdWZmZXJbMF0gPSByZWFkUmV2ZXJzZUJhc2U2NCgpKSAhPT0gRU5EX09GX0lOUFVUICYmXG4gICAgICAoaW5CdWZmZXJbMV0gPSByZWFkUmV2ZXJzZUJhc2U2NCgpKSAhPT0gRU5EX09GX0lOUFVUKSB7XG4gICAgICBpbkJ1ZmZlclsyXSA9IHJlYWRSZXZlcnNlQmFzZTY0KCk7XG4gICAgICBpbkJ1ZmZlclszXSA9IHJlYWRSZXZlcnNlQmFzZTY0KCk7XG4gICAgICByZXN1bHQgPSByZXN1bHQgKyBudG9zKCgoKGluQnVmZmVyWzBdIDw8IDIpICYgMHhmZikgfCBpbkJ1ZmZlclsxXSA+PlxuICAgICAgICA0KSk7XG4gICAgICBpZiAoaW5CdWZmZXJbMl0gIT09IEVORF9PRl9JTlBVVCkge1xuICAgICAgICByZXN1bHQgKz0gbnRvcygoKChpbkJ1ZmZlclsxXSA8PCA0KSAmIDB4ZmYpIHwgaW5CdWZmZXJbMl0gPj4gMikpO1xuICAgICAgICBpZiAoaW5CdWZmZXJbM10gIT09IEVORF9PRl9JTlBVVCkge1xuICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdCArIG50b3MoKCgoaW5CdWZmZXJbMl0gPDwgNikgJiAweGZmKSB8IGluQnVmZmVyW1xuICAgICAgICAgICAgICAzXSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGVuY29kZUJhc2U2NDogZW5jb2RlQmFzZTY0LFxuICAgIGRlY29kZUJhc2U2NDogZGVjb2RlQmFzZTY0LFxuICB9O1xufSgpKTtcbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIEBjbGFzcyBBdWRpb0NvZGVjXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgQXVkaW8gY29kZWMgZW51bWVyYXRpb24uXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjb25zdCBBdWRpb0NvZGVjID0ge1xuICBQQ01VOiAncGNtdScsXG4gIFBDTUE6ICdwY21hJyxcbiAgT1BVUzogJ29wdXMnLFxuICBHNzIyOiAnZzcyMicsXG4gIElTQUM6ICdpU0FDJyxcbiAgSUxCQzogJ2lMQkMnLFxuICBBQUM6ICdhYWMnLFxuICBBQzM6ICdhYzMnLFxuICBORUxMWU1PU0VSOiAnbmVsbHltb3NlcicsXG59O1xuLyoqXG4gKiBAY2xhc3MgQXVkaW9Db2RlY1BhcmFtZXRlcnNcbiAqIEBtZW1iZXJPZiBPd3QuQmFzZVxuICogQGNsYXNzRGVzYyBDb2RlYyBwYXJhbWV0ZXJzIGZvciBhbiBhdWRpbyB0cmFjay5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIEF1ZGlvQ29kZWNQYXJhbWV0ZXJzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IobmFtZSwgY2hhbm5lbENvdW50LCBjbG9ja1JhdGUpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtzdHJpbmd9IG5hbWVcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuQXVkaW9Db2RlY1BhcmFtZXRlcnNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBOYW1lIG9mIGEgY29kZWMuIFBsZWFzZSB1c2UgYSB2YWx1ZSBpbiBPd3QuQmFzZS5BdWRpb0NvZGVjLiBIb3dldmVyLCBzb21lIGZ1bmN0aW9ucyBkbyBub3Qgc3VwcG9ydCBhbGwgdGhlIHZhbHVlcyBpbiBPd3QuQmFzZS5BdWRpb0NvZGVjLlxuICAgICAqL1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gY2hhbm5lbENvdW50XG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLkF1ZGlvQ29kZWNQYXJhbWV0ZXJzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGRlc2MgTnVtYmVycyBvZiBjaGFubmVscyBmb3IgYW4gYXVkaW8gdHJhY2suXG4gICAgICovXG4gICAgdGhpcy5jaGFubmVsQ291bnQgPSBjaGFubmVsQ291bnQ7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gY2xvY2tSYXRlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLkF1ZGlvQ29kZWNQYXJhbWV0ZXJzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGRlc2MgVGhlIGNvZGVjIGNsb2NrIHJhdGUgZXhwcmVzc2VkIGluIEhlcnR6LlxuICAgICAqL1xuICAgIHRoaXMuY2xvY2tSYXRlID0gY2xvY2tSYXRlO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIEF1ZGlvRW5jb2RpbmdQYXJhbWV0ZXJzXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgRW5jb2RpbmcgcGFyYW1ldGVycyBmb3Igc2VuZGluZyBhbiBhdWRpbyB0cmFjay5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIEF1ZGlvRW5jb2RpbmdQYXJhbWV0ZXJzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoY29kZWMsIG1heEJpdHJhdGUpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/T3d0LkJhc2UuQXVkaW9Db2RlY1BhcmFtZXRlcnN9IGNvZGVjXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLkF1ZGlvRW5jb2RpbmdQYXJhbWV0ZXJzXG4gICAgICovXG4gICAgdGhpcy5jb2RlYyA9IGNvZGVjO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9udW1iZXJ9IG1heEJpdHJhdGVcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuQXVkaW9FbmNvZGluZ1BhcmFtZXRlcnNcbiAgICAgKiBAZGVzYyBNYXggYml0cmF0ZSBleHByZXNzZWQgaW4ga2Jwcy5cbiAgICAgKi9cbiAgICB0aGlzLm1heEJpdHJhdGUgPSBtYXhCaXRyYXRlO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIFZpZGVvQ29kZWNcbiAqIEBtZW1iZXJPZiBPd3QuQmFzZVxuICogQGNsYXNzRGVzYyBWaWRlbyBjb2RlYyBlbnVtZXJhdGlvbi5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNvbnN0IFZpZGVvQ29kZWMgPSB7XG4gIFZQODogJ3ZwOCcsXG4gIFZQOTogJ3ZwOScsXG4gIEgyNjQ6ICdoMjY0JyxcbiAgSDI2NTogJ2gyNjUnLFxufTtcblxuLyoqXG4gKiBAY2xhc3MgVmlkZW9Db2RlY1BhcmFtZXRlcnNcbiAqIEBtZW1iZXJPZiBPd3QuQmFzZVxuICogQGNsYXNzRGVzYyBDb2RlYyBwYXJhbWV0ZXJzIGZvciBhIHZpZGVvIHRyYWNrLlxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgVmlkZW9Db2RlY1BhcmFtZXRlcnMge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihuYW1lLCBwcm9maWxlKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBuYW1lXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlZpZGVvQ29kZWNQYXJhbWV0ZXJzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGRlc2MgTmFtZSBvZiBhIGNvZGVjLiBQbGVhc2UgdXNlIGEgdmFsdWUgaW4gT3d0LkJhc2UuVmlkZW9Db2RlYy4gSG93ZXZlciwgc29tZSBmdW5jdGlvbnMgZG8gbm90IHN1cHBvcnQgYWxsIHRoZSB2YWx1ZXMgaW4gT3d0LkJhc2UuQXVkaW9Db2RlYy5cbiAgICAgKi9cbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9zdHJpbmd9IHByb2ZpbGVcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9Db2RlY1BhcmFtZXRlcnNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBUaGUgcHJvZmlsZSBvZiBhIGNvZGVjLiBQcm9maWxlIG1heSBub3QgYXBwbHkgdG8gYWxsIGNvZGVjcy5cbiAgICAgKi9cbiAgICB0aGlzLnByb2ZpbGUgPSBwcm9maWxlO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIFZpZGVvRW5jb2RpbmdQYXJhbWV0ZXJzXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgRW5jb2RpbmcgcGFyYW1ldGVycyBmb3Igc2VuZGluZyBhIHZpZGVvIHRyYWNrLlxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgVmlkZW9FbmNvZGluZ1BhcmFtZXRlcnMge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcihjb2RlYywgbWF4Qml0cmF0ZSkge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9Pd3QuQmFzZS5WaWRlb0NvZGVjUGFyYW1ldGVyc30gY29kZWNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9FbmNvZGluZ1BhcmFtZXRlcnNcbiAgICAgKi9cbiAgICB0aGlzLmNvZGVjID0gY29kZWM7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gbWF4Qml0cmF0ZVxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5WaWRlb0VuY29kaW5nUGFyYW1ldGVyc1xuICAgICAqIEBkZXNjIE1heCBiaXRyYXRlIGV4cHJlc3NlZCBpbiBrYnBzLlxuICAgICAqL1xuICAgIHRoaXMubWF4Qml0cmF0ZSA9IG1heEJpdHJhdGU7XG4gIH1cbn1cbiIsIi8vIE1JVCBMaWNlbnNlXG4vL1xuLy8gQ29weXJpZ2h0IChjKSAyMDEyIFVuaXZlcnNpZGFkIFBvbGl0w6ljbmljYSBkZSBNYWRyaWRcbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4vLyBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4vLyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4vLyBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbi8vIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsXG4vLyBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1Jcbi8vIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuLy8gRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4vLyBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4vLyBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuLy8gT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEVcbi8vIFNPRlRXQVJFLlxuXG4vLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8vIFRoaXMgZmlsZSBpcyBib3Jyb3dlZCBmcm9tIGx5bmNraWEvbGljb2RlIHdpdGggc29tZSBtb2RpZmljYXRpb25zLlxuXG4ndXNlIHN0cmljdCc7XG5cbi8qKlxuICogQGNsYXNzIEV2ZW50RGlzcGF0Y2hlclxuICogQGNsYXNzRGVzYyBBIHNoaW0gZm9yIEV2ZW50VGFyZ2V0LiBNaWdodCBiZSBjaGFuZ2VkIHRvIEV2ZW50VGFyZ2V0IGxhdGVyLlxuICogQG1lbWJlcm9mIE93dC5CYXNlXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjb25zdCBFdmVudERpc3BhdGNoZXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gUHJpdmF0ZSB2YXJzXG4gIGNvbnN0IHNwZWMgPSB7fTtcbiAgc3BlYy5kaXNwYXRjaGVyID0ge307XG4gIHNwZWMuZGlzcGF0Y2hlci5ldmVudExpc3RlbmVycyA9IHt9O1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gYWRkRXZlbnRMaXN0ZW5lclxuICAgKiBAZGVzYyBUaGlzIGZ1bmN0aW9uIHJlZ2lzdGVycyBhIGNhbGxiYWNrIGZ1bmN0aW9uIGFzIGEgaGFuZGxlciBmb3IgdGhlIGNvcnJlc3BvbmRpbmcgZXZlbnQuIEl0J3Mgc2hvcnRlbmVkIGZvcm0gaXMgb24oZXZlbnRUeXBlLCBsaXN0ZW5lcikuIFNlZSB0aGUgZXZlbnQgZGVzY3JpcHRpb24gaW4gdGhlIGZvbGxvd2luZyB0YWJsZS5cbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5FdmVudERpc3BhdGNoZXJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50VHlwZSBFdmVudCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7ZnVuY3Rpb259IGxpc3RlbmVyIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKi9cbiAgdGhpcy5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnRUeXBlLCBsaXN0ZW5lcikge1xuICAgIGlmIChzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXSA9IFtdO1xuICAgIH1cbiAgICBzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgfTtcblxuICAvKipcbiAgICogQGZ1bmN0aW9uIHJlbW92ZUV2ZW50TGlzdGVuZXJcbiAgICogQGRlc2MgVGhpcyBmdW5jdGlvbiByZW1vdmVzIGEgcmVnaXN0ZXJlZCBldmVudCBsaXN0ZW5lci5cbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5FdmVudERpc3BhdGNoZXJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50VHlwZSBFdmVudCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7ZnVuY3Rpb259IGxpc3RlbmVyIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKi9cbiAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnRUeXBlLCBsaXN0ZW5lcikge1xuICAgIGlmICghc3BlYy5kaXNwYXRjaGVyLmV2ZW50TGlzdGVuZXJzW2V2ZW50VHlwZV0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgaW5kZXggPSBzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXS5pbmRleE9mKGxpc3RlbmVyKTtcbiAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICBzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXS5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgfTtcblxuICAvKipcbiAgICogQGZ1bmN0aW9uIGNsZWFyRXZlbnRMaXN0ZW5lclxuICAgKiBAZGVzYyBUaGlzIGZ1bmN0aW9uIHJlbW92ZXMgYWxsIGV2ZW50IGxpc3RlbmVycyBmb3Igb25lIHR5cGUuXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuRXZlbnREaXNwYXRjaGVyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudFR5cGUgRXZlbnQgc3RyaW5nLlxuICAgKi9cbiAgdGhpcy5jbGVhckV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudFR5cGUpIHtcbiAgICBzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnRUeXBlXSA9IFtdO1xuICB9O1xuXG4gIC8vIEl0IGRpc3BhdGNoIGEgbmV3IGV2ZW50IHRvIHRoZSBldmVudCBsaXN0ZW5lcnMsIGJhc2VkIG9uIHRoZSB0eXBlXG4gIC8vIG9mIGV2ZW50LiBBbGwgZXZlbnRzIGFyZSBpbnRlbmRlZCB0byBiZSBMaWNvZGVFdmVudHMuXG4gIHRoaXMuZGlzcGF0Y2hFdmVudCA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgaWYgKCFzcGVjLmRpc3BhdGNoZXIuZXZlbnRMaXN0ZW5lcnNbZXZlbnQudHlwZV0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgc3BlYy5kaXNwYXRjaGVyLmV2ZW50TGlzdGVuZXJzW2V2ZW50LnR5cGVdLm1hcChmdW5jdGlvbihsaXN0ZW5lcikge1xuICAgICAgbGlzdGVuZXIoZXZlbnQpO1xuICAgIH0pO1xuICB9O1xufTtcblxuLyoqXG4gKiBAY2xhc3MgT3d0RXZlbnRcbiAqIEBjbGFzc0Rlc2MgQ2xhc3MgT3d0RXZlbnQgcmVwcmVzZW50cyBhIGdlbmVyaWMgRXZlbnQgaW4gdGhlIGxpYnJhcnkuXG4gKiBAbWVtYmVyb2YgT3d0LkJhc2VcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIE93dEV2ZW50IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IodHlwZSkge1xuICAgIHRoaXMudHlwZSA9IHR5cGU7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgTWVzc2FnZUV2ZW50XG4gKiBAY2xhc3NEZXNjIENsYXNzIE1lc3NhZ2VFdmVudCByZXByZXNlbnRzIGEgbWVzc2FnZSBFdmVudCBpbiB0aGUgbGlicmFyeS5cbiAqIEBtZW1iZXJvZiBPd3QuQmFzZVxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgTWVzc2FnZUV2ZW50IGV4dGVuZHMgT3d0RXZlbnQge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcih0eXBlLCBpbml0KSB7XG4gICAgc3VwZXIodHlwZSk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBvcmlnaW5cbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuTWVzc2FnZUV2ZW50XG4gICAgICogQGRlc2MgSUQgb2YgdGhlIHJlbW90ZSBlbmRwb2ludCB3aG8gcHVibGlzaGVkIHRoaXMgc3RyZWFtLlxuICAgICAqL1xuICAgIHRoaXMub3JpZ2luID0gaW5pdC5vcmlnaW47XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBtZXNzYWdlXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLk1lc3NhZ2VFdmVudFxuICAgICAqL1xuICAgIHRoaXMubWVzc2FnZSA9IGluaXQubWVzc2FnZTtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtzdHJpbmd9IHRvXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLk1lc3NhZ2VFdmVudFxuICAgICAqIEBkZXNjIFZhbHVlcyBjb3VsZCBiZSBcImFsbFwiLCBcIm1lXCIgaW4gY29uZmVyZW5jZSBtb2RlLCBvciB1bmRlZmluZWQgaW4gUDJQIG1vZGUuLlxuICAgICAqL1xuICAgIHRoaXMudG8gPSBpbml0LnRvO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIEVycm9yRXZlbnRcbiAqIEBjbGFzc0Rlc2MgQ2xhc3MgRXJyb3JFdmVudCByZXByZXNlbnRzIGFuIGVycm9yIEV2ZW50IGluIHRoZSBsaWJyYXJ5LlxuICogQG1lbWJlcm9mIE93dC5CYXNlXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBFcnJvckV2ZW50IGV4dGVuZHMgT3d0RXZlbnQge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcih0eXBlLCBpbml0KSB7XG4gICAgc3VwZXIodHlwZSk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7RXJyb3J9IGVycm9yXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLkVycm9yRXZlbnRcbiAgICAgKi9cbiAgICB0aGlzLmVycm9yID0gaW5pdC5lcnJvcjtcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBNdXRlRXZlbnRcbiAqIEBjbGFzc0Rlc2MgQ2xhc3MgTXV0ZUV2ZW50IHJlcHJlc2VudHMgYSBtdXRlIG9yIHVubXV0ZSBldmVudC5cbiAqIEBtZW1iZXJvZiBPd3QuQmFzZVxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgTXV0ZUV2ZW50IGV4dGVuZHMgT3d0RXZlbnQge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcih0eXBlLCBpbml0KSB7XG4gICAgc3VwZXIodHlwZSk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7T3d0LkJhc2UuVHJhY2tLaW5kfSBraW5kXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLk11dGVFdmVudFxuICAgICAqL1xuICAgIHRoaXMua2luZCA9IGluaXQua2luZDtcbiAgfVxufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4ndXNlIHN0cmljdCc7XG5cbmV4cG9ydCAqIGZyb20gJy4vbWVkaWFzdHJlYW0tZmFjdG9yeS5qcyc7XG5leHBvcnQgKiBmcm9tICcuL3N0cmVhbS5qcyc7XG5leHBvcnQgKiBmcm9tICcuL21lZGlhZm9ybWF0LmpzJztcbiIsIi8vIE1JVCBMaWNlbnNlXG4vL1xuLy8gQ29weXJpZ2h0IChjKSAyMDEyIFVuaXZlcnNpZGFkIFBvbGl0w6ljbmljYSBkZSBNYWRyaWRcbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG4vLyBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG4vLyBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG4vLyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG4vLyBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbi8vIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsXG4vLyBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1Jcbi8vIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuLy8gRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG4vLyBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG4vLyBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuLy8gT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEVcbi8vIFNPRlRXQVJFLlxuXG4vLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8vIFRoaXMgZmlsZSBpcyBib3Jyb3dlZCBmcm9tIGx5bmNraWEvbGljb2RlIHdpdGggc29tZSBtb2RpZmljYXRpb25zLlxuXG4vKiBnbG9iYWwgY29uc29sZSx3aW5kb3cgKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vKlxuICogQVBJIHRvIHdyaXRlIGxvZ3MgYmFzZWQgb24gdHJhZGl0aW9uYWwgbG9nZ2luZyBtZWNoYW5pc21zOiBkZWJ1ZywgdHJhY2UsXG4gKiBpbmZvLCB3YXJuaW5nLCBlcnJvclxuICovXG5jb25zdCBMb2dnZXIgPSAoZnVuY3Rpb24oKSB7XG4gIGNvbnN0IERFQlVHID0gMDtcbiAgY29uc3QgVFJBQ0UgPSAxO1xuICBjb25zdCBJTkZPID0gMjtcbiAgY29uc3QgV0FSTklORyA9IDM7XG4gIGNvbnN0IEVSUk9SID0gNDtcbiAgY29uc3QgTk9ORSA9IDU7XG5cbiAgY29uc3Qgbm9PcCA9IGZ1bmN0aW9uKCkge307XG5cbiAgLy8gfHRoYXR8IGlzIHRoZSBvYmplY3QgdG8gYmUgcmV0dXJuZWQuXG4gIGNvbnN0IHRoYXQgPSB7XG4gICAgREVCVUc6IERFQlVHLFxuICAgIFRSQUNFOiBUUkFDRSxcbiAgICBJTkZPOiBJTkZPLFxuICAgIFdBUk5JTkc6IFdBUk5JTkcsXG4gICAgRVJST1I6IEVSUk9SLFxuICAgIE5PTkU6IE5PTkUsXG4gIH07XG5cbiAgdGhhdC5sb2cgPSB3aW5kb3cuY29uc29sZS5sb2cuYmluZCh3aW5kb3cuY29uc29sZSk7XG5cbiAgY29uc3QgYmluZFR5cGUgPSBmdW5jdGlvbih0eXBlKSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cuY29uc29sZVt0eXBlXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHdpbmRvdy5jb25zb2xlW3R5cGVdLmJpbmQod2luZG93LmNvbnNvbGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gd2luZG93LmNvbnNvbGUubG9nLmJpbmQod2luZG93LmNvbnNvbGUpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBzZXRMb2dMZXZlbCA9IGZ1bmN0aW9uKGxldmVsKSB7XG4gICAgaWYgKGxldmVsIDw9IERFQlVHKSB7XG4gICAgICB0aGF0LmRlYnVnID0gYmluZFR5cGUoJ2xvZycpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGF0LmRlYnVnID0gbm9PcDtcbiAgICB9XG4gICAgaWYgKGxldmVsIDw9IFRSQUNFKSB7XG4gICAgICB0aGF0LnRyYWNlID0gYmluZFR5cGUoJ3RyYWNlJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoYXQudHJhY2UgPSBub09wO1xuICAgIH1cbiAgICBpZiAobGV2ZWwgPD0gSU5GTykge1xuICAgICAgdGhhdC5pbmZvID0gYmluZFR5cGUoJ2luZm8nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhhdC5pbmZvID0gbm9PcDtcbiAgICB9XG4gICAgaWYgKGxldmVsIDw9IFdBUk5JTkcpIHtcbiAgICAgIHRoYXQud2FybmluZyA9IGJpbmRUeXBlKCd3YXJuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoYXQud2FybmluZyA9IG5vT3A7XG4gICAgfVxuICAgIGlmIChsZXZlbCA8PSBFUlJPUikge1xuICAgICAgdGhhdC5lcnJvciA9IGJpbmRUeXBlKCdlcnJvcicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGF0LmVycm9yID0gbm9PcDtcbiAgICB9XG4gIH07XG5cbiAgc2V0TG9nTGV2ZWwoREVCVUcpOyAvLyBEZWZhdWx0IGxldmVsIGlzIGRlYnVnLlxuXG4gIHRoYXQuc2V0TG9nTGV2ZWwgPSBzZXRMb2dMZXZlbDtcblxuICByZXR1cm4gdGhhdDtcbn0oKSk7XG5cbmV4cG9ydCBkZWZhdWx0IExvZ2dlcjtcbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuJ3VzZSBzdHJpY3QnO1xuLyoqXG4gKiBAY2xhc3MgQXVkaW9Tb3VyY2VJbmZvXG4gKiBAY2xhc3NEZXNjIFNvdXJjZSBpbmZvIGFib3V0IGFuIGF1ZGlvIHRyYWNrLiBWYWx1ZXM6ICdtaWMnLCAnc2NyZWVuLWNhc3QnLCAnZmlsZScsICdtaXhlZCcuXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEByZWFkb25seVxuICogQGVudW0ge3N0cmluZ31cbiAqL1xuZXhwb3J0IGNvbnN0IEF1ZGlvU291cmNlSW5mbyA9IHtcbiAgTUlDOiAnbWljJyxcbiAgU0NSRUVOQ0FTVDogJ3NjcmVlbi1jYXN0JyxcbiAgRklMRTogJ2ZpbGUnLFxuICBNSVhFRDogJ21peGVkJyxcbn07XG5cbi8qKlxuICogQGNsYXNzIFZpZGVvU291cmNlSW5mb1xuICogQGNsYXNzRGVzYyBTb3VyY2UgaW5mbyBhYm91dCBhIHZpZGVvIHRyYWNrLiBWYWx1ZXM6ICdjYW1lcmEnLCAnc2NyZWVuLWNhc3QnLCAnZmlsZScsICdtaXhlZCcuXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEByZWFkb25seVxuICogQGVudW0ge3N0cmluZ31cbiAqL1xuZXhwb3J0IGNvbnN0IFZpZGVvU291cmNlSW5mbyA9IHtcbiAgQ0FNRVJBOiAnY2FtZXJhJyxcbiAgU0NSRUVOQ0FTVDogJ3NjcmVlbi1jYXN0JyxcbiAgRklMRTogJ2ZpbGUnLFxuICBNSVhFRDogJ21peGVkJyxcbn07XG5cbi8qKlxuICogQGNsYXNzIFRyYWNrS2luZFxuICogQGNsYXNzRGVzYyBLaW5kIG9mIGEgdHJhY2suIFZhbHVlczogJ2F1ZGlvJyBmb3IgYXVkaW8gdHJhY2ssICd2aWRlbycgZm9yIHZpZGVvIHRyYWNrLCAnYXYnIGZvciBib3RoIGF1ZGlvIGFuZCB2aWRlbyB0cmFja3MuXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEByZWFkb25seVxuICogQGVudW0ge3N0cmluZ31cbiAqL1xuZXhwb3J0IGNvbnN0IFRyYWNrS2luZCA9IHtcbiAgLyoqXG4gICAqIEF1ZGlvIHRyYWNrcy5cbiAgICogQHR5cGUgc3RyaW5nXG4gICAqL1xuICBBVURJTzogJ2F1ZGlvJyxcbiAgLyoqXG4gICAqIFZpZGVvIHRyYWNrcy5cbiAgICogQHR5cGUgc3RyaW5nXG4gICAqL1xuICBWSURFTzogJ3ZpZGVvJyxcbiAgLyoqXG4gICAqIEJvdGggYXVkaW8gYW5kIHZpZGVvIHRyYWNrcy5cbiAgICogQHR5cGUgc3RyaW5nXG4gICAqL1xuICBBVURJT19BTkRfVklERU86ICdhdicsXG59O1xuLyoqXG4gKiBAY2xhc3MgUmVzb2x1dGlvblxuICogQG1lbWJlck9mIE93dC5CYXNlXG4gKiBAY2xhc3NEZXNjIFRoZSBSZXNvbHV0aW9uIGRlZmluZXMgdGhlIHNpemUgb2YgYSByZWN0YW5nbGUuXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7bnVtYmVyfSB3aWR0aFxuICogQHBhcmFtIHtudW1iZXJ9IGhlaWdodFxuICovXG5leHBvcnQgY2xhc3MgUmVzb2x1dGlvbiB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKHdpZHRoLCBoZWlnaHQpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtudW1iZXJ9IHdpZHRoXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlJlc29sdXRpb25cbiAgICAgKi9cbiAgICB0aGlzLndpZHRoID0gd2lkdGg7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7bnVtYmVyfSBoZWlnaHRcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuUmVzb2x1dGlvblxuICAgICAqL1xuICAgIHRoaXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8qIGdsb2JhbCBjb25zb2xlLCB3aW5kb3csIFByb21pc2UsIGNocm9tZSwgbmF2aWdhdG9yICovXG5cbid1c2Ugc3RyaWN0JztcbmltcG9ydCAqIGFzIHV0aWxzIGZyb20gJy4vdXRpbHMuanMnO1xuaW1wb3J0IExvZ2dlciBmcm9tICcuL2xvZ2dlci5qcyc7XG5pbXBvcnQgKiBhcyBNZWRpYUZvcm1hdE1vZHVsZSBmcm9tICcuL21lZGlhZm9ybWF0LmpzJztcblxuLyoqXG4gKiBAY2xhc3MgQXVkaW9UcmFja0NvbnN0cmFpbnRzXG4gKiBAY2xhc3NEZXNjIENvbnN0cmFpbnRzIGZvciBjcmVhdGluZyBhbiBhdWRpbyBNZWRpYVN0cmVhbVRyYWNrLlxuICogQG1lbWJlcm9mIE93dC5CYXNlXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7T3d0LkJhc2UuQXVkaW9Tb3VyY2VJbmZvfSBzb3VyY2UgU291cmNlIGluZm8gb2YgdGhpcyBhdWRpbyB0cmFjay5cbiAqL1xuZXhwb3J0IGNsYXNzIEF1ZGlvVHJhY2tDb25zdHJhaW50cyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKHNvdXJjZSkge1xuICAgIGlmICghT2JqZWN0LnZhbHVlcyhNZWRpYUZvcm1hdE1vZHVsZS5BdWRpb1NvdXJjZUluZm8pXG4gICAgICAgIC5zb21lKCh2KSA9PiB2ID09PSBzb3VyY2UpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHNvdXJjZS4nKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBzb3VyY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuQXVkaW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgVmFsdWVzIGNvdWxkIGJlIFwibWljXCIsIFwic2NyZWVuLWNhc3RcIiwgXCJmaWxlXCIgb3IgXCJtaXhlZFwiLlxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqL1xuICAgIHRoaXMuc291cmNlID0gc291cmNlO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gZGV2aWNlSWRcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuQXVkaW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgRG8gbm90IHByb3ZpZGUgZGV2aWNlSWQgaWYgc291cmNlIGlzIG5vdCBcIm1pY1wiLlxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBzZWUgaHR0cHM6Ly93M2MuZ2l0aHViLmlvL21lZGlhY2FwdHVyZS1tYWluLyNkZWYtY29uc3RyYWludC1kZXZpY2VJZFxuICAgICAqL1xuICAgIHRoaXMuZGV2aWNlSWQgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgVmlkZW9UcmFja0NvbnN0cmFpbnRzXG4gKiBAY2xhc3NEZXNjIENvbnN0cmFpbnRzIGZvciBjcmVhdGluZyBhIHZpZGVvIE1lZGlhU3RyZWFtVHJhY2suXG4gKiBAbWVtYmVyb2YgT3d0LkJhc2VcbiAqIEBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtPd3QuQmFzZS5WaWRlb1NvdXJjZUluZm99IHNvdXJjZSBTb3VyY2UgaW5mbyBvZiB0aGlzIHZpZGVvIHRyYWNrLlxuICovXG5leHBvcnQgY2xhc3MgVmlkZW9UcmFja0NvbnN0cmFpbnRzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3Ioc291cmNlKSB7XG4gICAgaWYgKCFPYmplY3QudmFsdWVzKE1lZGlhRm9ybWF0TW9kdWxlLlZpZGVvU291cmNlSW5mbylcbiAgICAgIC5zb21lKCh2KSA9PiB2ID09PSBzb3VyY2UpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHNvdXJjZS4nKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBzb3VyY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgVmFsdWVzIGNvdWxkIGJlIFwiY2FtZXJhXCIsIFwic2NyZWVuLWNhc3RcIiwgXCJmaWxlXCIgb3IgXCJtaXhlZFwiLlxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqL1xuICAgIHRoaXMuc291cmNlID0gc291cmNlO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gZGV2aWNlSWRcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgRG8gbm90IHByb3ZpZGUgZGV2aWNlSWQgaWYgc291cmNlIGlzIG5vdCBcImNhbWVyYVwiLlxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBzZWUgaHR0cHM6Ly93M2MuZ2l0aHViLmlvL21lZGlhY2FwdHVyZS1tYWluLyNkZWYtY29uc3RyYWludC1kZXZpY2VJZFxuICAgICAqL1xuXG4gICAgdGhpcy5kZXZpY2VJZCA9IHVuZGVmaW5lZDtcblxuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge093dC5CYXNlLlJlc29sdXRpb259IHJlc29sdXRpb25cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGluc3RhbmNlXG4gICAgICovXG4gICAgdGhpcy5yZXNvbHV0aW9uID0gdW5kZWZpbmVkO1xuXG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7bnVtYmVyfSBmcmFtZVJhdGVcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9UcmFja0NvbnN0cmFpbnRzXG4gICAgICogQGluc3RhbmNlXG4gICAgICovXG4gICAgdGhpcy5mcmFtZVJhdGUgPSB1bmRlZmluZWQ7XG4gIH1cbn1cbi8qKlxuICogQGNsYXNzIFN0cmVhbUNvbnN0cmFpbnRzXG4gKiBAY2xhc3NEZXNjIENvbnN0cmFpbnRzIGZvciBjcmVhdGluZyBhIE1lZGlhU3RyZWFtIGZyb20gc2NyZWVuIG1pYyBhbmQgY2FtZXJhLlxuICogQG1lbWJlcm9mIE93dC5CYXNlXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7P093dC5CYXNlLkF1ZGlvVHJhY2tDb25zdHJhaW50c30gYXVkaW9Db25zdHJhaW50c1xuICogQHBhcmFtIHs/T3d0LkJhc2UuVmlkZW9UcmFja0NvbnN0cmFpbnRzfSB2aWRlb0NvbnN0cmFpbnRzXG4gKi9cbmV4cG9ydCBjbGFzcyBTdHJlYW1Db25zdHJhaW50cyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGF1ZGlvQ29uc3RyYWludHMgPSBmYWxzZSwgdmlkZW9Db25zdHJhaW50cyA9IGZhbHNlKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7T3d0LkJhc2UuTWVkaWFTdHJlYW1UcmFja0RldmljZUNvbnN0cmFpbnRzRm9yQXVkaW99IGF1ZGlvXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLk1lZGlhU3RyZWFtRGV2aWNlQ29uc3RyYWludHNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKi9cbiAgICB0aGlzLmF1ZGlvID0gYXVkaW9Db25zdHJhaW50cztcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtPd3QuQmFzZS5NZWRpYVN0cmVhbVRyYWNrRGV2aWNlQ29uc3RyYWludHNGb3JWaWRlb30gVmlkZW9cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuTWVkaWFTdHJlYW1EZXZpY2VDb25zdHJhaW50c1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqL1xuICAgIHRoaXMudmlkZW8gPSB2aWRlb0NvbnN0cmFpbnRzO1xuICB9XG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG5mdW5jdGlvbiBpc1ZpZGVvQ29uc3RyYWluc0ZvclNjcmVlbkNhc3QoY29uc3RyYWludHMpIHtcbiAgcmV0dXJuICh0eXBlb2YgY29uc3RyYWludHMudmlkZW8gPT09ICdvYmplY3QnICYmIGNvbnN0cmFpbnRzLnZpZGVvLnNvdXJjZSA9PT1cbiAgICBNZWRpYUZvcm1hdE1vZHVsZS5WaWRlb1NvdXJjZUluZm8uU0NSRUVOQ0FTVCk7XG59XG5cbi8qKlxuICogQGNsYXNzIE1lZGlhU3RyZWFtRmFjdG9yeVxuICogQGNsYXNzRGVzYyBBIGZhY3RvcnkgdG8gY3JlYXRlIE1lZGlhU3RyZWFtLiBZb3UgY2FuIGFsc28gY3JlYXRlIE1lZGlhU3RyZWFtIGJ5IHlvdXJzZWxmLlxuICogQG1lbWJlcm9mIE93dC5CYXNlXG4gKi9cbmV4cG9ydCBjbGFzcyBNZWRpYVN0cmVhbUZhY3Rvcnkge1xuICAvKipcbiAgICogQGZ1bmN0aW9uIGNyZWF0ZU1lZGlhU3RyZWFtXG4gICAqIEBzdGF0aWNcbiAgICogQGRlc2MgQ3JlYXRlIGEgTWVkaWFTdHJlYW0gd2l0aCBnaXZlbiBjb25zdHJhaW50cy4gSWYgeW91IHdhbnQgdG8gY3JlYXRlIGEgTWVkaWFTdHJlYW0gZm9yIHNjcmVlbiBjYXN0LCBwbGVhc2UgbWFrZSBzdXJlIGJvdGggYXVkaW8gYW5kIHZpZGVvJ3Mgc291cmNlIGFyZSBcInNjcmVlbi1jYXN0XCIuXG4gICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5NZWRpYVN0cmVhbUZhY3RvcnlcbiAgICogQHJldHVybnMge1Byb21pc2U8TWVkaWFTdHJlYW0sIEVycm9yPn0gUmV0dXJuIGEgcHJvbWlzZSB0aGF0IGlzIHJlc29sdmVkIHdoZW4gc3RyZWFtIGlzIHN1Y2Nlc3NmdWxseSBjcmVhdGVkLCBvciByZWplY3RlZCBpZiBvbmUgb2YgdGhlIGZvbGxvd2luZyBlcnJvciBoYXBwZW5lZDpcbiAgICogLSBPbmUgb3IgbW9yZSBwYXJhbWV0ZXJzIGNhbm5vdCBiZSBzYXRpc2ZpZWQuXG4gICAqIC0gU3BlY2lmaWVkIGRldmljZSBpcyBidXN5LlxuICAgKiAtIENhbm5vdCBvYnRhaW4gbmVjZXNzYXJ5IHBlcm1pc3Npb24gb3Igb3BlcmF0aW9uIGlzIGNhbmNlbGVkIGJ5IHVzZXIuXG4gICAqIC0gVmlkZW8gc291cmNlIGlzIHNjcmVlbiBjYXN0LCB3aGlsZSBhdWRpbyBzb3VyY2UgaXMgbm90LlxuICAgKiAtIEF1ZGlvIHNvdXJjZSBpcyBzY3JlZW4gY2FzdCwgd2hpbGUgdmlkZW8gc291cmNlIGlzIGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge093dC5CYXNlLlN0cmVhbUNvbnN0cmFpbnRzfSBjb25zdHJhaW50c1xuICAgKi9cbiAgc3RhdGljIGNyZWF0ZU1lZGlhU3RyZWFtKGNvbnN0cmFpbnRzKSB7XG4gICAgaWYgKHR5cGVvZiBjb25zdHJhaW50cyAhPT0gJ29iamVjdCcgfHxcbiAgICAgICAgKCFjb25zdHJhaW50cy5hdWRpbyAmJiAhY29uc3RyYWludHMudmlkZW8pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignSW52YWxpZCBjb25zdHJhaW5zJykpO1xuICAgIH1cbiAgICBpZiAoIWlzVmlkZW9Db25zdHJhaW5zRm9yU2NyZWVuQ2FzdChjb25zdHJhaW50cykgJiZcbiAgICAgICAgKHR5cGVvZiBjb25zdHJhaW50cy5hdWRpbyA9PT0gJ29iamVjdCcpICYmXG4gICAgICAgIGNvbnN0cmFpbnRzLmF1ZGlvLnNvdXJjZSA9PT1cbiAgICAgICAgICAgIE1lZGlhRm9ybWF0TW9kdWxlLkF1ZGlvU291cmNlSW5mby5TQ1JFRU5DQVNUKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgICAgbmV3IFR5cGVFcnJvcignQ2Fubm90IHNoYXJlIHNjcmVlbiB3aXRob3V0IHZpZGVvLicpKTtcbiAgICB9XG4gICAgaWYgKGlzVmlkZW9Db25zdHJhaW5zRm9yU2NyZWVuQ2FzdChjb25zdHJhaW50cykgJiZcbiAgICAgICAgdHlwZW9mIGNvbnN0cmFpbnRzLmF1ZGlvID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBjb25zdHJhaW50cy5hdWRpby5zb3VyY2UgIT09XG4gICAgICAgICAgICBNZWRpYUZvcm1hdE1vZHVsZS5BdWRpb1NvdXJjZUluZm8uU0NSRUVOQ0FTVCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgJ0Nhbm5vdCBjYXB0dXJlIHZpZGVvIGZyb20gc2NyZWVuIGNhc3Qgd2hpbGUgY2FwdHVyZSBhdWRpbyBmcm9tJ1xuICAgICAgICAgICsgJyBvdGhlciBzb3VyY2UuJykpO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGFuZCBjb252ZXJ0IGNvbnN0cmFpbnRzLlxuICAgIGlmICghY29uc3RyYWludHMuYXVkaW8gJiYgIWNvbnN0cmFpbnRzLnZpZGVvKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcihcbiAgICAgICAgJ0F0IGxlYXN0IG9uZSBvZiBhdWRpbyBhbmQgdmlkZW8gbXVzdCBiZSByZXF1ZXN0ZWQuJykpO1xuICAgIH1cbiAgICBjb25zdCBtZWRpYUNvbnN0cmFpbnRzID0gT2JqZWN0LmNyZWF0ZSh7fSk7XG4gICAgaWYgKHR5cGVvZiBjb25zdHJhaW50cy5hdWRpbyA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgY29uc3RyYWludHMuYXVkaW8uc291cmNlID09PSBNZWRpYUZvcm1hdE1vZHVsZS5BdWRpb1NvdXJjZUluZm8uTUlDKSB7XG4gICAgICBtZWRpYUNvbnN0cmFpbnRzLmF1ZGlvID0gT2JqZWN0LmNyZWF0ZSh7fSk7XG4gICAgICBpZiAodXRpbHMuaXNFZGdlKCkpIHtcbiAgICAgICAgbWVkaWFDb25zdHJhaW50cy5hdWRpby5kZXZpY2VJZCA9IGNvbnN0cmFpbnRzLmF1ZGlvLmRldmljZUlkO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVkaWFDb25zdHJhaW50cy5hdWRpby5kZXZpY2VJZCA9IHtcbiAgICAgICAgICBleGFjdDogY29uc3RyYWludHMuYXVkaW8uZGV2aWNlSWQsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChjb25zdHJhaW50cy5hdWRpby5zb3VyY2UgPT09IE1lZGlhRm9ybWF0TW9kdWxlLkF1ZGlvU291cmNlSW5mby5TQ1JFRU5DQVNUKSB7XG4gICAgICAgIG1lZGlhQ29uc3RyYWludHMuYXVkaW8gPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVkaWFDb25zdHJhaW50cy5hdWRpbyA9IGNvbnN0cmFpbnRzLmF1ZGlvO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGNvbnN0cmFpbnRzLnZpZGVvID09PSAnb2JqZWN0Jykge1xuICAgICAgbWVkaWFDb25zdHJhaW50cy52aWRlbyA9IE9iamVjdC5jcmVhdGUoe30pO1xuICAgICAgaWYgKHR5cGVvZiBjb25zdHJhaW50cy52aWRlby5mcmFtZVJhdGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgIG1lZGlhQ29uc3RyYWludHMudmlkZW8uZnJhbWVSYXRlID0gY29uc3RyYWludHMudmlkZW8uZnJhbWVSYXRlO1xuICAgICAgfVxuICAgICAgaWYgKGNvbnN0cmFpbnRzLnZpZGVvLnJlc29sdXRpb24gJiZcbiAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5yZXNvbHV0aW9uLndpZHRoICYmXG4gICAgICAgICAgY29uc3RyYWludHMudmlkZW8ucmVzb2x1dGlvbi5oZWlnaHQpIHtcbiAgICAgICAgICAgIGlmIChjb25zdHJhaW50cy52aWRlby5zb3VyY2UgPT09XG4gICAgICAgICAgICAgIE1lZGlhRm9ybWF0TW9kdWxlLlZpZGVvU291cmNlSW5mby5TQ1JFRU5DQVNUKSB7XG4gICAgICAgICAgICAgIG1lZGlhQ29uc3RyYWludHMudmlkZW8ud2lkdGggPVxuICAgICAgICAgICAgICAgIGNvbnN0cmFpbnRzLnZpZGVvLnJlc29sdXRpb24ud2lkdGg7XG4gICAgICAgICAgICAgIG1lZGlhQ29uc3RyYWludHMudmlkZW8uaGVpZ2h0ID1cbiAgICAgICAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5yZXNvbHV0aW9uLmhlaWdodDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG1lZGlhQ29uc3RyYWludHMudmlkZW8ud2lkdGggPSBPYmplY3QuY3JlYXRlKHt9KTtcbiAgICAgICAgICAgICAgbWVkaWFDb25zdHJhaW50cy52aWRlby53aWR0aC5leGFjdCA9XG4gICAgICAgICAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5yZXNvbHV0aW9uLndpZHRoO1xuICAgICAgICAgICAgICBtZWRpYUNvbnN0cmFpbnRzLnZpZGVvLmhlaWdodCA9IE9iamVjdC5jcmVhdGUoe30pO1xuICAgICAgICAgICAgICBtZWRpYUNvbnN0cmFpbnRzLnZpZGVvLmhlaWdodC5leGFjdCA9XG4gICAgICAgICAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5yZXNvbHV0aW9uLmhlaWdodDtcblxuICAgICAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBjb25zdHJhaW50cy52aWRlby5kZXZpY2VJZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgbWVkaWFDb25zdHJhaW50cy52aWRlby5kZXZpY2VJZCA9IHsgZXhhY3Q6IGNvbnN0cmFpbnRzLnZpZGVvLmRldmljZUlkIH07XG4gICAgICB9XG4gICAgICBpZiAodXRpbHMuaXNGaXJlZm94KCkgJiZcbiAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5zb3VyY2UgPT09XG4gICAgICAgICAgICAgIE1lZGlhRm9ybWF0TW9kdWxlLlZpZGVvU291cmNlSW5mby5TQ1JFRU5DQVNUKSB7XG4gICAgICAgIG1lZGlhQ29uc3RyYWludHMudmlkZW8ubWVkaWFTb3VyY2UgPSAnc2NyZWVuJztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbWVkaWFDb25zdHJhaW50cy52aWRlbyA9IGNvbnN0cmFpbnRzLnZpZGVvO1xuICAgIH1cblxuICAgIGlmIChpc1ZpZGVvQ29uc3RyYWluc0ZvclNjcmVlbkNhc3QoY29uc3RyYWludHMpKSB7XG4gICAgICByZXR1cm4gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXREaXNwbGF5TWVkaWEobWVkaWFDb25zdHJhaW50cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShtZWRpYUNvbnN0cmFpbnRzKTtcbiAgICB9XG4gIH1cbn1cbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuJ3VzZSBzdHJpY3QnO1xuXG5pbXBvcnQgKiBhcyBVdGlscyBmcm9tICcuL3V0aWxzLmpzJztcbmltcG9ydCAqIGFzIE1lZGlhRm9ybWF0IGZyb20gJy4vbWVkaWFmb3JtYXQuanMnO1xuaW1wb3J0IHtFdmVudERpc3BhdGNoZXJ9IGZyb20gJy4uL2Jhc2UvZXZlbnQuanMnO1xuXG4vKipcbiAqIEBjbGFzcyBBdWRpb1B1YmxpY2F0aW9uU2V0dGluZ3NcbiAqIEBtZW1iZXJPZiBPd3QuQmFzZVxuICogQGNsYXNzRGVzYyBUaGUgYXVkaW8gc2V0dGluZ3Mgb2YgYSBwdWJsaWNhdGlvbi5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIEF1ZGlvUHVibGljYXRpb25TZXR0aW5ncyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGNvZGVjKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P093dC5CYXNlLkF1ZGlvQ29kZWNQYXJhbWV0ZXJzfSBjb2RlY1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5BdWRpb1B1YmxpY2F0aW9uU2V0dGluZ3NcbiAgICAgKi9cbiAgICB0aGlzLmNvZGVjID0gY29kZWM7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgVmlkZW9QdWJsaWNhdGlvblNldHRpbmdzXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgVGhlIHZpZGVvIHNldHRpbmdzIG9mIGEgcHVibGljYXRpb24uXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBWaWRlb1B1YmxpY2F0aW9uU2V0dGluZ3Mge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcihjb2RlYywgcmVzb2x1dGlvbiwgZnJhbWVSYXRlLCBiaXRyYXRlLCBrZXlGcmFtZUludGVydmFsLCByaWQpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/T3d0LkJhc2UuVmlkZW9Db2RlY1BhcmFtZXRlcnN9IGNvZGVjXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlZpZGVvUHVibGljYXRpb25TZXR0aW5nc1xuICAgICAqL1xuICAgIHRoaXMuY29kZWM9Y29kZWMsXG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P093dC5CYXNlLlJlc29sdXRpb259IHJlc29sdXRpb25cbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9QdWJsaWNhdGlvblNldHRpbmdzXG4gICAgICovXG4gICAgdGhpcy5yZXNvbHV0aW9uPXJlc29sdXRpb247XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gZnJhbWVSYXRlc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBjbGFzc0Rlc2MgRnJhbWVzIHBlciBzZWNvbmQuXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlZpZGVvUHVibGljYXRpb25TZXR0aW5nc1xuICAgICAqL1xuICAgIHRoaXMuZnJhbWVSYXRlPWZyYW1lUmF0ZTtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/bnVtYmVyfSBiaXRyYXRlXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlZpZGVvUHVibGljYXRpb25TZXR0aW5nc1xuICAgICAqL1xuICAgIHRoaXMuYml0cmF0ZT1iaXRyYXRlO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9udW1iZXJ9IGtleUZyYW1lSW50ZXJ2YWxzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGNsYXNzRGVzYyBUaGUgdGltZSBpbnRlcnZhbCBiZXR3ZWVuIGtleSBmcmFtZXMuIFVuaXQ6IHNlY29uZC5cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuVmlkZW9QdWJsaWNhdGlvblNldHRpbmdzXG4gICAgICovXG4gICAgdGhpcy5rZXlGcmFtZUludGVydmFsPWtleUZyYW1lSW50ZXJ2YWw7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gcmlkXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGNsYXNzRGVzYyBSZXN0cmljdGlvbiBpZGVudGlmaWVyIHRvIGlkZW50aWZ5IHRoZSBSVFAgU3RyZWFtcyB3aXRoaW4gYW4gUlRQIHNlc3Npb24uXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlZpZGVvUHVibGljYXRpb25TZXR0aW5nc1xuICAgICAqL1xuICAgIHRoaXMucmlkPXJpZDtcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBQdWJsaWNhdGlvblNldHRpbmdzXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgVGhlIHNldHRpbmdzIG9mIGEgcHVibGljYXRpb24uXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBQdWJsaWNhdGlvblNldHRpbmdzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoYXVkaW8sIHZpZGVvKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7T3d0LkJhc2UuQXVkaW9QdWJsaWNhdGlvblNldHRpbmdzW119IGF1ZGlvXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlB1YmxpY2F0aW9uU2V0dGluZ3NcbiAgICAgKi9cbiAgICB0aGlzLmF1ZGlvPWF1ZGlvO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge093dC5CYXNlLlZpZGVvUHVibGljYXRpb25TZXR0aW5nc1tdfSB2aWRlb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5QdWJsaWNhdGlvblNldHRpbmdzXG4gICAgICovXG4gICAgdGhpcy52aWRlbz12aWRlbztcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBQdWJsaWNhdGlvblxuICogQGV4dGVuZHMgT3d0LkJhc2UuRXZlbnREaXNwYXRjaGVyXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgUHVibGljYXRpb24gcmVwcmVzZW50cyBhIHNlbmRlciBmb3IgcHVibGlzaGluZyBhIHN0cmVhbS4gSXRcbiAqIGhhbmRsZXMgdGhlIGFjdGlvbnMgb24gYSBMb2NhbFN0cmVhbSBwdWJsaXNoZWQgdG8gYSBjb25mZXJlbmNlLlxuICpcbiAqIEV2ZW50czpcbiAqXG4gKiB8IEV2ZW50IE5hbWUgICAgICB8IEFyZ3VtZW50IFR5cGUgICAgfCBGaXJlZCB3aGVuICAgICAgIHxcbiAqIHwgLS0tLS0tLS0tLS0tLS0tLXwgLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0gfFxuICogfCBlbmRlZCAgICAgICAgICAgfCBFdmVudCAgICAgICAgICAgIHwgUHVibGljYXRpb24gaXMgZW5kZWQuIHxcbiAqIHwgZXJyb3IgICAgICAgICAgIHwgRXJyb3JFdmVudCAgICAgICB8IEFuIGVycm9yIG9jY3VycmVkIG9uIHRoZSBwdWJsaWNhdGlvbi4gfFxuICogfCBtdXRlICAgICAgICAgICAgfCBNdXRlRXZlbnQgICAgICAgIHwgUHVibGljYXRpb24gaXMgbXV0ZWQuIENsaWVudCBzdG9wcGVkIHNlbmRpbmcgYXVkaW8gYW5kL29yIHZpZGVvIGRhdGEgdG8gcmVtb3RlIGVuZHBvaW50LiB8XG4gKiB8IHVubXV0ZSAgICAgICAgICB8IE11dGVFdmVudCAgICAgICAgfCBQdWJsaWNhdGlvbiBpcyB1bm11dGVkLiBDbGllbnQgY29udGludWVkIHNlbmRpbmcgYXVkaW8gYW5kL29yIHZpZGVvIGRhdGEgdG8gcmVtb3RlIGVuZHBvaW50LiB8XG4gKlxuICogYGVuZGVkYCBldmVudCBtYXkgbm90IGJlIGZpcmVkIG9uIFNhZmFyaSBhZnRlciBjYWxsaW5nIGBQdWJsaWNhdGlvbi5zdG9wKClgLlxuICpcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFB1YmxpY2F0aW9uIGV4dGVuZHMgRXZlbnREaXNwYXRjaGVyIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoaWQsIHN0b3AsIGdldFN0YXRzLCBtdXRlLCB1bm11dGUpIHtcbiAgICBzdXBlcigpO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gaWRcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuUHVibGljYXRpb25cbiAgICAgKi9cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ2lkJywge1xuICAgICAgY29uZmlndXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgIHZhbHVlOiBpZCA/IGlkIDogVXRpbHMuY3JlYXRlVXVpZCgpLFxuICAgIH0pO1xuICAgIC8qKlxuICAgICAqIEBmdW5jdGlvbiBzdG9wXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGRlc2MgU3RvcCBjZXJ0YWluIHB1YmxpY2F0aW9uLiBPbmNlIGEgc3Vic2NyaXB0aW9uIGlzIHN0b3BwZWQsIGl0IGNhbm5vdCBiZSByZWNvdmVyZWQuXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlB1YmxpY2F0aW9uXG4gICAgICogQHJldHVybnMge3VuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLnN0b3AgPSBzdG9wO1xuICAgIC8qKlxuICAgICAqIEBmdW5jdGlvbiBnZXRTdGF0c1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBkZXNjIEdldCBzdGF0cyBvZiB1bmRlcmx5aW5nIFBlZXJDb25uZWN0aW9uLlxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5QdWJsaWNhdGlvblxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPFJUQ1N0YXRzUmVwb3J0LCBFcnJvcj59XG4gICAgICovXG4gICAgdGhpcy5nZXRTdGF0cyA9IGdldFN0YXRzO1xuICAgIC8qKlxuICAgICAqIEBmdW5jdGlvbiBtdXRlXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQGRlc2MgU3RvcCBzZW5kaW5nIGRhdGEgdG8gcmVtb3RlIGVuZHBvaW50LlxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5QdWJsaWNhdGlvblxuICAgICAqIEBwYXJhbSB7T3d0LkJhc2UuVHJhY2tLaW5kIH0ga2luZCBLaW5kIG9mIHRyYWNrcyB0byBiZSBtdXRlZC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx1bmRlZmluZWQsIEVycm9yPn1cbiAgICAgKi9cbiAgICB0aGlzLm11dGUgPSBtdXRlO1xuICAgIC8qKlxuICAgICAqIEBmdW5jdGlvbiB1bm11dGVcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBDb250aW51ZSBzZW5kaW5nIGRhdGEgdG8gcmVtb3RlIGVuZHBvaW50LlxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5QdWJsaWNhdGlvblxuICAgICAqIEBwYXJhbSB7T3d0LkJhc2UuVHJhY2tLaW5kIH0ga2luZCBLaW5kIG9mIHRyYWNrcyB0byBiZSB1bm11dGVkLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHVuZGVmaW5lZCwgRXJyb3I+fVxuICAgICAqL1xuICAgIHRoaXMudW5tdXRlID0gdW5tdXRlO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIFB1Ymxpc2hPcHRpb25zXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgUHVibGlzaE9wdGlvbnMgZGVmaW5lcyBvcHRpb25zIGZvciBwdWJsaXNoaW5nIGEgT3d0LkJhc2UuTG9jYWxTdHJlYW0uXG4gKi9cbmV4cG9ydCBjbGFzcyBQdWJsaXNoT3B0aW9ucyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGF1ZGlvLCB2aWRlbykge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9BcnJheTxPd3QuQmFzZS5BdWRpb0VuY29kaW5nUGFyYW1ldGVycz4gfCA/QXJyYXk8UlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzPn0gYXVkaW9cbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuUHVibGlzaE9wdGlvbnNcbiAgICAgKiBAZGVzYyBQYXJhbWV0ZXJzIGZvciBhdWRpbyBSdHBTZW5kZXIuIFB1Ymxpc2hpbmcgd2l0aCBSVENSdHBFbmNvZGluZ1BhcmFtZXRlcnMgaXMgYW4gZXhwZXJpbWVudGFsIGZlYXR1cmUuIEl0IGlzIHN1YmplY3QgdG8gY2hhbmdlLlxuICAgICAqL1xuICAgIHRoaXMuYXVkaW8gPSBhdWRpbztcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/QXJyYXk8T3d0LkJhc2UuVmlkZW9FbmNvZGluZ1BhcmFtZXRlcnM+IHwgP0FycmF5PFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycz59IHZpZGVvXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlB1Ymxpc2hPcHRpb25zXG4gICAgICogQGRlc2MgUGFyYW1ldGVycyBmb3IgdmlkZW8gUnRwU2VuZGVyLiBQdWJsaXNoaW5nIHdpdGggUlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzIGlzIGFuIGV4cGVyaW1lbnRhbCBmZWF0dXJlLiBJdCBpcyBzdWJqZWN0IHRvIGNoYW5nZS5cbiAgICAgKi9cbiAgICB0aGlzLnZpZGVvID0gdmlkZW87XG4gIH1cbn1cbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuXG4vKiBNb3JlIGluZm9ybWF0aW9uIGFib3V0IHRoZXNlIG9wdGlvbnMgYXQganNoaW50LmNvbS9kb2NzL29wdGlvbnMgKi9cblxuLyogZXNsaW50LWRpc2FibGUgKi9cblxuLyogZ2xvYmFscyAgYWRhcHRlciwgdHJhY2UgKi9cbi8qIGV4cG9ydGVkIHNldENvZGVjUGFyYW0sIGljZUNhbmRpZGF0ZVR5cGUsIGZvcm1hdFR5cGVQcmVmZXJlbmNlLFxuICAgbWF5YmVTZXRPcHVzT3B0aW9ucywgbWF5YmVQcmVmZXJBdWRpb1JlY2VpdmVDb2RlYyxcbiAgIG1heWJlUHJlZmVyQXVkaW9TZW5kQ29kZWMsIG1heWJlU2V0QXVkaW9SZWNlaXZlQml0UmF0ZSxcbiAgIG1heWJlU2V0QXVkaW9TZW5kQml0UmF0ZSwgbWF5YmVQcmVmZXJWaWRlb1JlY2VpdmVDb2RlYyxcbiAgIG1heWJlUHJlZmVyVmlkZW9TZW5kQ29kZWMsIG1heWJlU2V0VmlkZW9SZWNlaXZlQml0UmF0ZSxcbiAgIG1heWJlU2V0VmlkZW9TZW5kQml0UmF0ZSwgbWF5YmVTZXRWaWRlb1NlbmRJbml0aWFsQml0UmF0ZSxcbiAgIG1heWJlUmVtb3ZlVmlkZW9GZWMsIG1lcmdlQ29uc3RyYWludHMsIHJlbW92ZUNvZGVjUGFyYW0qL1xuXG4vKiBUaGlzIGZpbGUgaXMgYm9ycm93ZWQgZnJvbSBhcHBydGMgd2l0aCBzb21lIG1vZGlmaWNhdGlvbnMuICovXG4vKiBDb21taXQgaGFzaDogYzZhZjBjMjVlOWFmNTI3ZjcxYjNhY2RkNmJmYTEzODlkNzc4ZjdiZCArIFBSIDUzMCAqL1xuXG5pbXBvcnQgTG9nZ2VyIGZyb20gJy4vbG9nZ2VyLmpzJztcblxuJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBtZXJnZUNvbnN0cmFpbnRzKGNvbnMxLCBjb25zMikge1xuICBpZiAoIWNvbnMxIHx8ICFjb25zMikge1xuICAgIHJldHVybiBjb25zMSB8fCBjb25zMjtcbiAgfVxuICBjb25zdCBtZXJnZWQgPSBjb25zMTtcbiAgZm9yIChjb25zdCBrZXkgaW4gY29uczIpIHtcbiAgICBtZXJnZWRba2V5XSA9IGNvbnMyW2tleV07XG4gIH1cbiAgcmV0dXJuIG1lcmdlZDtcbn1cblxuZnVuY3Rpb24gaWNlQ2FuZGlkYXRlVHlwZShjYW5kaWRhdGVTdHIpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZVN0ci5zcGxpdCgnICcpWzddO1xufVxuXG4vLyBUdXJucyB0aGUgbG9jYWwgdHlwZSBwcmVmZXJlbmNlIGludG8gYSBodW1hbi1yZWFkYWJsZSBzdHJpbmcuXG4vLyBOb3RlIHRoYXQgdGhpcyBtYXBwaW5nIGlzIGJyb3dzZXItc3BlY2lmaWMuXG5mdW5jdGlvbiBmb3JtYXRUeXBlUHJlZmVyZW5jZShwcmVmKSB7XG4gIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgc3dpdGNoIChwcmVmKSB7XG4gICAgICBjYXNlIDA6XG4gICAgICAgIHJldHVybiAnVFVSTi9UTFMnO1xuICAgICAgY2FzZSAxOlxuICAgICAgICByZXR1cm4gJ1RVUk4vVENQJztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgcmV0dXJuICdUVVJOL1VEUCc7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICBzd2l0Y2ggKHByZWYpIHtcbiAgICAgIGNhc2UgMDpcbiAgICAgICAgcmV0dXJuICdUVVJOL1RDUCc7XG4gICAgICBjYXNlIDU6XG4gICAgICAgIHJldHVybiAnVFVSTi9VRFAnO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiAnJztcbn1cblxuZnVuY3Rpb24gbWF5YmVTZXRPcHVzT3B0aW9ucyhzZHAsIHBhcmFtcykge1xuICAvLyBTZXQgT3B1cyBpbiBTdGVyZW8sIGlmIHN0ZXJlbyBpcyB0cnVlLCB1bnNldCBpdCwgaWYgc3RlcmVvIGlzIGZhbHNlLCBhbmRcbiAgLy8gZG8gbm90aGluZyBpZiBvdGhlcndpc2UuXG4gIGlmIChwYXJhbXMub3B1c1N0ZXJlbyA9PT0gJ3RydWUnKSB7XG4gICAgc2RwID0gc2V0Q29kZWNQYXJhbShzZHAsICdvcHVzLzQ4MDAwJywgJ3N0ZXJlbycsICcxJyk7XG4gIH0gZWxzZSBpZiAocGFyYW1zLm9wdXNTdGVyZW8gPT09ICdmYWxzZScpIHtcbiAgICBzZHAgPSByZW1vdmVDb2RlY1BhcmFtKHNkcCwgJ29wdXMvNDgwMDAnLCAnc3RlcmVvJyk7XG4gIH1cblxuICAvLyBTZXQgT3B1cyBGRUMsIGlmIG9wdXNmZWMgaXMgdHJ1ZSwgdW5zZXQgaXQsIGlmIG9wdXNmZWMgaXMgZmFsc2UsIGFuZFxuICAvLyBkbyBub3RoaW5nIGlmIG90aGVyd2lzZS5cbiAgaWYgKHBhcmFtcy5vcHVzRmVjID09PSAndHJ1ZScpIHtcbiAgICBzZHAgPSBzZXRDb2RlY1BhcmFtKHNkcCwgJ29wdXMvNDgwMDAnLCAndXNlaW5iYW5kZmVjJywgJzEnKTtcbiAgfSBlbHNlIGlmIChwYXJhbXMub3B1c0ZlYyA9PT0gJ2ZhbHNlJykge1xuICAgIHNkcCA9IHJlbW92ZUNvZGVjUGFyYW0oc2RwLCAnb3B1cy80ODAwMCcsICd1c2VpbmJhbmRmZWMnKTtcbiAgfVxuXG4gIC8vIFNldCBPcHVzIERUWCwgaWYgb3B1c2R0eCBpcyB0cnVlLCB1bnNldCBpdCwgaWYgb3B1c2R0eCBpcyBmYWxzZSwgYW5kXG4gIC8vIGRvIG5vdGhpbmcgaWYgb3RoZXJ3aXNlLlxuICBpZiAocGFyYW1zLm9wdXNEdHggPT09ICd0cnVlJykge1xuICAgIHNkcCA9IHNldENvZGVjUGFyYW0oc2RwLCAnb3B1cy80ODAwMCcsICd1c2VkdHgnLCAnMScpO1xuICB9IGVsc2UgaWYgKHBhcmFtcy5vcHVzRHR4ID09PSAnZmFsc2UnKSB7XG4gICAgc2RwID0gcmVtb3ZlQ29kZWNQYXJhbShzZHAsICdvcHVzLzQ4MDAwJywgJ3VzZWR0eCcpO1xuICB9XG5cbiAgLy8gU2V0IE9wdXMgbWF4cGxheWJhY2tyYXRlLCBpZiByZXF1ZXN0ZWQuXG4gIGlmIChwYXJhbXMub3B1c01heFBicikge1xuICAgIHNkcCA9IHNldENvZGVjUGFyYW0oXG4gICAgICAgIHNkcCwgJ29wdXMvNDgwMDAnLCAnbWF4cGxheWJhY2tyYXRlJywgcGFyYW1zLm9wdXNNYXhQYnIpO1xuICB9XG4gIHJldHVybiBzZHA7XG59XG5cbmZ1bmN0aW9uIG1heWJlU2V0QXVkaW9TZW5kQml0UmF0ZShzZHAsIHBhcmFtcykge1xuICBpZiAoIXBhcmFtcy5hdWRpb1NlbmRCaXRyYXRlKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuICBMb2dnZXIuZGVidWcoJ1ByZWZlciBhdWRpbyBzZW5kIGJpdHJhdGU6ICcgKyBwYXJhbXMuYXVkaW9TZW5kQml0cmF0ZSk7XG4gIHJldHVybiBwcmVmZXJCaXRSYXRlKHNkcCwgcGFyYW1zLmF1ZGlvU2VuZEJpdHJhdGUsICdhdWRpbycpO1xufVxuXG5mdW5jdGlvbiBtYXliZVNldEF1ZGlvUmVjZWl2ZUJpdFJhdGUoc2RwLCBwYXJhbXMpIHtcbiAgaWYgKCFwYXJhbXMuYXVkaW9SZWN2Qml0cmF0ZSkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cbiAgTG9nZ2VyLmRlYnVnKCdQcmVmZXIgYXVkaW8gcmVjZWl2ZSBiaXRyYXRlOiAnICsgcGFyYW1zLmF1ZGlvUmVjdkJpdHJhdGUpO1xuICByZXR1cm4gcHJlZmVyQml0UmF0ZShzZHAsIHBhcmFtcy5hdWRpb1JlY3ZCaXRyYXRlLCAnYXVkaW8nKTtcbn1cblxuZnVuY3Rpb24gbWF5YmVTZXRWaWRlb1NlbmRCaXRSYXRlKHNkcCwgcGFyYW1zKSB7XG4gIGlmICghcGFyYW1zLnZpZGVvU2VuZEJpdHJhdGUpIHtcbiAgICByZXR1cm4gc2RwO1xuICB9XG4gIExvZ2dlci5kZWJ1ZygnUHJlZmVyIHZpZGVvIHNlbmQgYml0cmF0ZTogJyArIHBhcmFtcy52aWRlb1NlbmRCaXRyYXRlKTtcbiAgcmV0dXJuIHByZWZlckJpdFJhdGUoc2RwLCBwYXJhbXMudmlkZW9TZW5kQml0cmF0ZSwgJ3ZpZGVvJyk7XG59XG5cbmZ1bmN0aW9uIG1heWJlU2V0VmlkZW9SZWNlaXZlQml0UmF0ZShzZHAsIHBhcmFtcykge1xuICBpZiAoIXBhcmFtcy52aWRlb1JlY3ZCaXRyYXRlKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuICBMb2dnZXIuZGVidWcoJ1ByZWZlciB2aWRlbyByZWNlaXZlIGJpdHJhdGU6ICcgKyBwYXJhbXMudmlkZW9SZWN2Qml0cmF0ZSk7XG4gIHJldHVybiBwcmVmZXJCaXRSYXRlKHNkcCwgcGFyYW1zLnZpZGVvUmVjdkJpdHJhdGUsICd2aWRlbycpO1xufVxuXG4vLyBBZGQgYSBiPUFTOmJpdHJhdGUgbGluZSB0byB0aGUgbT1tZWRpYVR5cGUgc2VjdGlvbi5cbmZ1bmN0aW9uIHByZWZlckJpdFJhdGUoc2RwLCBiaXRyYXRlLCBtZWRpYVR5cGUpIHtcbiAgY29uc3Qgc2RwTGluZXMgPSBzZHAuc3BsaXQoJ1xcclxcbicpO1xuXG4gIC8vIEZpbmQgbSBsaW5lIGZvciB0aGUgZ2l2ZW4gbWVkaWFUeXBlLlxuICBjb25zdCBtTGluZUluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdtPScsIG1lZGlhVHlwZSk7XG4gIGlmIChtTGluZUluZGV4ID09PSBudWxsKSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdGYWlsZWQgdG8gYWRkIGJhbmR3aWR0aCBsaW5lIHRvIHNkcCwgYXMgbm8gbS1saW5lIGZvdW5kJyk7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIC8vIEZpbmQgbmV4dCBtLWxpbmUgaWYgYW55LlxuICBsZXQgbmV4dE1MaW5lSW5kZXggPSBmaW5kTGluZUluUmFuZ2Uoc2RwTGluZXMsIG1MaW5lSW5kZXggKyAxLCAtMSwgJ209Jyk7XG4gIGlmIChuZXh0TUxpbmVJbmRleCA9PT0gbnVsbCkge1xuICAgIG5leHRNTGluZUluZGV4ID0gc2RwTGluZXMubGVuZ3RoO1xuICB9XG5cbiAgLy8gRmluZCBjLWxpbmUgY29ycmVzcG9uZGluZyB0byB0aGUgbS1saW5lLlxuICBjb25zdCBjTGluZUluZGV4ID0gZmluZExpbmVJblJhbmdlKHNkcExpbmVzLCBtTGluZUluZGV4ICsgMSxcbiAgICAgIG5leHRNTGluZUluZGV4LCAnYz0nKTtcbiAgaWYgKGNMaW5lSW5kZXggPT09IG51bGwpIHtcbiAgICBMb2dnZXIuZGVidWcoJ0ZhaWxlZCB0byBhZGQgYmFuZHdpZHRoIGxpbmUgdG8gc2RwLCBhcyBubyBjLWxpbmUgZm91bmQnKTtcbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgLy8gQ2hlY2sgaWYgYmFuZHdpZHRoIGxpbmUgYWxyZWFkeSBleGlzdHMgYmV0d2VlbiBjLWxpbmUgYW5kIG5leHQgbS1saW5lLlxuICBjb25zdCBiTGluZUluZGV4ID0gZmluZExpbmVJblJhbmdlKHNkcExpbmVzLCBjTGluZUluZGV4ICsgMSxcbiAgICAgIG5leHRNTGluZUluZGV4LCAnYj1BUycpO1xuICBpZiAoYkxpbmVJbmRleCkge1xuICAgIHNkcExpbmVzLnNwbGljZShiTGluZUluZGV4LCAxKTtcbiAgfVxuXG4gIC8vIENyZWF0ZSB0aGUgYiAoYmFuZHdpZHRoKSBzZHAgbGluZS5cbiAgY29uc3QgYndMaW5lID0gJ2I9QVM6JyArIGJpdHJhdGU7XG4gIC8vIEFzIHBlciBSRkMgNDU2NiwgdGhlIGIgbGluZSBzaG91bGQgZm9sbG93IGFmdGVyIGMtbGluZS5cbiAgc2RwTGluZXMuc3BsaWNlKGNMaW5lSW5kZXggKyAxLCAwLCBid0xpbmUpO1xuICBzZHAgPSBzZHBMaW5lcy5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIHNkcDtcbn1cblxuLy8gQWRkIGFuIGE9Zm10cDogeC1nb29nbGUtbWluLWJpdHJhdGU9a2JwcyBsaW5lLCBpZiB2aWRlb1NlbmRJbml0aWFsQml0cmF0ZVxuLy8gaXMgc3BlY2lmaWVkLiBXZSdsbCBhbHNvIGFkZCBhIHgtZ29vZ2xlLW1pbi1iaXRyYXRlIHZhbHVlLCBzaW5jZSB0aGUgbWF4XG4vLyBtdXN0IGJlID49IHRoZSBtaW4uXG5mdW5jdGlvbiBtYXliZVNldFZpZGVvU2VuZEluaXRpYWxCaXRSYXRlKHNkcCwgcGFyYW1zKSB7XG4gIGxldCBpbml0aWFsQml0cmF0ZSA9IHBhcnNlSW50KHBhcmFtcy52aWRlb1NlbmRJbml0aWFsQml0cmF0ZSk7XG4gIGlmICghaW5pdGlhbEJpdHJhdGUpIHtcbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgdGhlIGluaXRpYWwgYml0cmF0ZSB2YWx1ZS5cbiAgbGV0IG1heEJpdHJhdGUgPSBwYXJzZUludChpbml0aWFsQml0cmF0ZSk7XG4gIGNvbnN0IGJpdHJhdGUgPSBwYXJzZUludChwYXJhbXMudmlkZW9TZW5kQml0cmF0ZSk7XG4gIGlmIChiaXRyYXRlKSB7XG4gICAgaWYgKGluaXRpYWxCaXRyYXRlID4gYml0cmF0ZSkge1xuICAgICAgTG9nZ2VyLmRlYnVnKCdDbGFtcGluZyBpbml0aWFsIGJpdHJhdGUgdG8gbWF4IGJpdHJhdGUgb2YgJyArIGJpdHJhdGUgKyAnIGticHMuJyk7XG4gICAgICBpbml0aWFsQml0cmF0ZSA9IGJpdHJhdGU7XG4gICAgICBwYXJhbXMudmlkZW9TZW5kSW5pdGlhbEJpdHJhdGUgPSBpbml0aWFsQml0cmF0ZTtcbiAgICB9XG4gICAgbWF4Qml0cmF0ZSA9IGJpdHJhdGU7XG4gIH1cblxuICBjb25zdCBzZHBMaW5lcyA9IHNkcC5zcGxpdCgnXFxyXFxuJyk7XG5cbiAgLy8gU2VhcmNoIGZvciBtIGxpbmUuXG4gIGNvbnN0IG1MaW5lSW5kZXggPSBmaW5kTGluZShzZHBMaW5lcywgJ209JywgJ3ZpZGVvJyk7XG4gIGlmIChtTGluZUluZGV4ID09PSBudWxsKSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdGYWlsZWQgdG8gZmluZCB2aWRlbyBtLWxpbmUnKTtcbiAgICByZXR1cm4gc2RwO1xuICB9XG4gIC8vIEZpZ3VyZSBvdXQgdGhlIGZpcnN0IGNvZGVjIHBheWxvYWQgdHlwZSBvbiB0aGUgbT12aWRlbyBTRFAgbGluZS5cbiAgY29uc3QgdmlkZW9NTGluZSA9IHNkcExpbmVzW21MaW5lSW5kZXhdO1xuICBjb25zdCBwYXR0ZXJuID0gbmV3IFJlZ0V4cCgnbT12aWRlb1xcXFxzXFxcXGQrXFxcXHNbQS1aL10rXFxcXHMnKTtcbiAgY29uc3Qgc2VuZFBheWxvYWRUeXBlID0gdmlkZW9NTGluZS5zcGxpdChwYXR0ZXJuKVsxXS5zcGxpdCgnICcpWzBdO1xuICBjb25zdCBmbXRwTGluZSA9IHNkcExpbmVzW2ZpbmRMaW5lKHNkcExpbmVzLCAnYT1ydHBtYXAnLCBzZW5kUGF5bG9hZFR5cGUpXTtcbiAgY29uc3QgY29kZWNOYW1lID0gZm10cExpbmUuc3BsaXQoJ2E9cnRwbWFwOicgK1xuICAgICAgc2VuZFBheWxvYWRUeXBlKVsxXS5zcGxpdCgnLycpWzBdO1xuXG4gIC8vIFVzZSBjb2RlYyBmcm9tIHBhcmFtcyBpZiBzcGVjaWZpZWQgdmlhIFVSTCBwYXJhbSwgb3RoZXJ3aXNlIHVzZSBmcm9tIFNEUC5cbiAgY29uc3QgY29kZWMgPSBwYXJhbXMudmlkZW9TZW5kQ29kZWMgfHwgY29kZWNOYW1lO1xuICBzZHAgPSBzZXRDb2RlY1BhcmFtKHNkcCwgY29kZWMsICd4LWdvb2dsZS1taW4tYml0cmF0ZScsXG4gICAgICBwYXJhbXMudmlkZW9TZW5kSW5pdGlhbEJpdHJhdGUudG9TdHJpbmcoKSk7XG4gIHNkcCA9IHNldENvZGVjUGFyYW0oc2RwLCBjb2RlYywgJ3gtZ29vZ2xlLW1heC1iaXRyYXRlJyxcbiAgICAgIG1heEJpdHJhdGUudG9TdHJpbmcoKSk7XG5cbiAgcmV0dXJuIHNkcDtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlUGF5bG9hZFR5cGVGcm9tTWxpbmUobUxpbmUsIHBheWxvYWRUeXBlKSB7XG4gIG1MaW5lID0gbUxpbmUuc3BsaXQoJyAnKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtTGluZS5sZW5ndGg7ICsraSkge1xuICAgIGlmIChtTGluZVtpXSA9PT0gcGF5bG9hZFR5cGUudG9TdHJpbmcoKSkge1xuICAgICAgbUxpbmUuc3BsaWNlKGksIDEpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbUxpbmUuam9pbignICcpO1xufVxuXG5mdW5jdGlvbiByZW1vdmVDb2RlY0J5TmFtZShzZHBMaW5lcywgY29kZWMpIHtcbiAgY29uc3QgaW5kZXggPSBmaW5kTGluZShzZHBMaW5lcywgJ2E9cnRwbWFwJywgY29kZWMpO1xuICBpZiAoaW5kZXggPT09IG51bGwpIHtcbiAgICByZXR1cm4gc2RwTGluZXM7XG4gIH1cbiAgY29uc3QgcGF5bG9hZFR5cGUgPSBnZXRDb2RlY1BheWxvYWRUeXBlRnJvbUxpbmUoc2RwTGluZXNbaW5kZXhdKTtcbiAgc2RwTGluZXMuc3BsaWNlKGluZGV4LCAxKTtcblxuICAvLyBTZWFyY2ggZm9yIHRoZSB2aWRlbyBtPSBsaW5lIGFuZCByZW1vdmUgdGhlIGNvZGVjLlxuICBjb25zdCBtTGluZUluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdtPScsICd2aWRlbycpO1xuICBpZiAobUxpbmVJbmRleCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHBMaW5lcztcbiAgfVxuICBzZHBMaW5lc1ttTGluZUluZGV4XSA9IHJlbW92ZVBheWxvYWRUeXBlRnJvbU1saW5lKHNkcExpbmVzW21MaW5lSW5kZXhdLFxuICAgICAgcGF5bG9hZFR5cGUpO1xuICByZXR1cm4gc2RwTGluZXM7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUNvZGVjQnlQYXlsb2FkVHlwZShzZHBMaW5lcywgcGF5bG9hZFR5cGUpIHtcbiAgY29uc3QgaW5kZXggPSBmaW5kTGluZShzZHBMaW5lcywgJ2E9cnRwbWFwJywgcGF5bG9hZFR5cGUudG9TdHJpbmcoKSk7XG4gIGlmIChpbmRleCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHBMaW5lcztcbiAgfVxuICBzZHBMaW5lcy5zcGxpY2UoaW5kZXgsIDEpO1xuXG4gIC8vIFNlYXJjaCBmb3IgdGhlIHZpZGVvIG09IGxpbmUgYW5kIHJlbW92ZSB0aGUgY29kZWMuXG4gIGNvbnN0IG1MaW5lSW5kZXggPSBmaW5kTGluZShzZHBMaW5lcywgJ209JywgJ3ZpZGVvJyk7XG4gIGlmIChtTGluZUluZGV4ID09PSBudWxsKSB7XG4gICAgcmV0dXJuIHNkcExpbmVzO1xuICB9XG4gIHNkcExpbmVzW21MaW5lSW5kZXhdID0gcmVtb3ZlUGF5bG9hZFR5cGVGcm9tTWxpbmUoc2RwTGluZXNbbUxpbmVJbmRleF0sXG4gICAgICBwYXlsb2FkVHlwZSk7XG4gIHJldHVybiBzZHBMaW5lcztcbn1cblxuZnVuY3Rpb24gbWF5YmVSZW1vdmVWaWRlb0ZlYyhzZHAsIHBhcmFtcykge1xuICBpZiAocGFyYW1zLnZpZGVvRmVjICE9PSAnZmFsc2UnKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIGxldCBzZHBMaW5lcyA9IHNkcC5zcGxpdCgnXFxyXFxuJyk7XG5cbiAgbGV0IGluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdhPXJ0cG1hcCcsICdyZWQnKTtcbiAgaWYgKGluZGV4ID09PSBudWxsKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuICBjb25zdCByZWRQYXlsb2FkVHlwZSA9IGdldENvZGVjUGF5bG9hZFR5cGVGcm9tTGluZShzZHBMaW5lc1tpbmRleF0pO1xuICBzZHBMaW5lcyA9IHJlbW92ZUNvZGVjQnlQYXlsb2FkVHlwZShzZHBMaW5lcywgcmVkUGF5bG9hZFR5cGUpO1xuXG4gIHNkcExpbmVzID0gcmVtb3ZlQ29kZWNCeU5hbWUoc2RwTGluZXMsICd1bHBmZWMnKTtcblxuICAvLyBSZW1vdmUgZm10cCBsaW5lcyBhc3NvY2lhdGVkIHdpdGggcmVkIGNvZGVjLlxuICBpbmRleCA9IGZpbmRMaW5lKHNkcExpbmVzLCAnYT1mbXRwJywgcmVkUGF5bG9hZFR5cGUudG9TdHJpbmcoKSk7XG4gIGlmIChpbmRleCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cbiAgY29uc3QgZm10cExpbmUgPSBwYXJzZUZtdHBMaW5lKHNkcExpbmVzW2luZGV4XSk7XG4gIGNvbnN0IHJ0eFBheWxvYWRUeXBlID0gZm10cExpbmUucHQ7XG4gIGlmIChydHhQYXlsb2FkVHlwZSA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cbiAgc2RwTGluZXMuc3BsaWNlKGluZGV4LCAxKTtcblxuICBzZHBMaW5lcyA9IHJlbW92ZUNvZGVjQnlQYXlsb2FkVHlwZShzZHBMaW5lcywgcnR4UGF5bG9hZFR5cGUpO1xuICByZXR1cm4gc2RwTGluZXMuam9pbignXFxyXFxuJyk7XG59XG5cbi8vIFByb21vdGVzIHxhdWRpb1NlbmRDb2RlY3wgdG8gYmUgdGhlIGZpcnN0IGluIHRoZSBtPWF1ZGlvIGxpbmUsIGlmIHNldC5cbmZ1bmN0aW9uIG1heWJlUHJlZmVyQXVkaW9TZW5kQ29kZWMoc2RwLCBwYXJhbXMpIHtcbiAgcmV0dXJuIG1heWJlUHJlZmVyQ29kZWMoc2RwLCAnYXVkaW8nLCAnc2VuZCcsIHBhcmFtcy5hdWRpb1NlbmRDb2RlYyk7XG59XG5cbi8vIFByb21vdGVzIHxhdWRpb1JlY3ZDb2RlY3wgdG8gYmUgdGhlIGZpcnN0IGluIHRoZSBtPWF1ZGlvIGxpbmUsIGlmIHNldC5cbmZ1bmN0aW9uIG1heWJlUHJlZmVyQXVkaW9SZWNlaXZlQ29kZWMoc2RwLCBwYXJhbXMpIHtcbiAgcmV0dXJuIG1heWJlUHJlZmVyQ29kZWMoc2RwLCAnYXVkaW8nLCAncmVjZWl2ZScsIHBhcmFtcy5hdWRpb1JlY3ZDb2RlYyk7XG59XG5cbi8vIFByb21vdGVzIHx2aWRlb1NlbmRDb2RlY3wgdG8gYmUgdGhlIGZpcnN0IGluIHRoZSBtPWF1ZGlvIGxpbmUsIGlmIHNldC5cbmZ1bmN0aW9uIG1heWJlUHJlZmVyVmlkZW9TZW5kQ29kZWMoc2RwLCBwYXJhbXMpIHtcbiAgcmV0dXJuIG1heWJlUHJlZmVyQ29kZWMoc2RwLCAndmlkZW8nLCAnc2VuZCcsIHBhcmFtcy52aWRlb1NlbmRDb2RlYyk7XG59XG5cbi8vIFByb21vdGVzIHx2aWRlb1JlY3ZDb2RlY3wgdG8gYmUgdGhlIGZpcnN0IGluIHRoZSBtPWF1ZGlvIGxpbmUsIGlmIHNldC5cbmZ1bmN0aW9uIG1heWJlUHJlZmVyVmlkZW9SZWNlaXZlQ29kZWMoc2RwLCBwYXJhbXMpIHtcbiAgcmV0dXJuIG1heWJlUHJlZmVyQ29kZWMoc2RwLCAndmlkZW8nLCAncmVjZWl2ZScsIHBhcmFtcy52aWRlb1JlY3ZDb2RlYyk7XG59XG5cbi8vIFNldHMgfGNvZGVjfCBhcyB0aGUgZGVmYXVsdCB8dHlwZXwgY29kZWMgaWYgaXQncyBwcmVzZW50LlxuLy8gVGhlIGZvcm1hdCBvZiB8Y29kZWN8IGlzICdOQU1FL1JBVEUnLCBlLmcuICdvcHVzLzQ4MDAwJy5cbmZ1bmN0aW9uIG1heWJlUHJlZmVyQ29kZWMoc2RwLCB0eXBlLCBkaXIsIGNvZGVjKSB7XG4gIGNvbnN0IHN0ciA9IHR5cGUgKyAnICcgKyBkaXIgKyAnIGNvZGVjJztcbiAgaWYgKCFjb2RlYykge1xuICAgIExvZ2dlci5kZWJ1ZygnTm8gcHJlZmVyZW5jZSBvbiAnICsgc3RyICsgJy4nKTtcbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgTG9nZ2VyLmRlYnVnKCdQcmVmZXIgJyArIHN0ciArICc6ICcgKyBjb2RlYyk7XG5cbiAgY29uc3Qgc2RwTGluZXMgPSBzZHAuc3BsaXQoJ1xcclxcbicpO1xuXG4gIC8vIFNlYXJjaCBmb3IgbSBsaW5lLlxuICBjb25zdCBtTGluZUluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdtPScsIHR5cGUpO1xuICBpZiAobUxpbmVJbmRleCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICAvLyBJZiB0aGUgY29kZWMgaXMgYXZhaWxhYmxlLCBzZXQgaXQgYXMgdGhlIGRlZmF1bHQgaW4gbSBsaW5lLlxuICBsZXQgcGF5bG9hZCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2RwTGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBpbmRleCA9IGZpbmRMaW5lSW5SYW5nZShzZHBMaW5lcywgaSwgLTEsICdhPXJ0cG1hcCcsIGNvZGVjKTtcbiAgICBpZiAoaW5kZXggIT09IG51bGwpIHtcbiAgICAgIHBheWxvYWQgPSBnZXRDb2RlY1BheWxvYWRUeXBlRnJvbUxpbmUoc2RwTGluZXNbaW5kZXhdKTtcbiAgICAgIGlmIChwYXlsb2FkKSB7XG4gICAgICAgIHNkcExpbmVzW21MaW5lSW5kZXhdID0gc2V0RGVmYXVsdENvZGVjKHNkcExpbmVzW21MaW5lSW5kZXhdLCBwYXlsb2FkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzZHAgPSBzZHBMaW5lcy5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIHNkcDtcbn1cblxuLy8gU2V0IGZtdHAgcGFyYW0gdG8gc3BlY2lmaWMgY29kZWMgaW4gU0RQLiBJZiBwYXJhbSBkb2VzIG5vdCBleGlzdHMsIGFkZCBpdC5cbmZ1bmN0aW9uIHNldENvZGVjUGFyYW0oc2RwLCBjb2RlYywgcGFyYW0sIHZhbHVlKSB7XG4gIGxldCBzZHBMaW5lcyA9IHNkcC5zcGxpdCgnXFxyXFxuJyk7XG4gIC8vIFNEUHMgc2VudCBmcm9tIE1DVSB1c2UgXFxuIGFzIGxpbmUgYnJlYWsuXG4gIGlmIChzZHBMaW5lcy5sZW5ndGggPD0gMSkge1xuICAgIHNkcExpbmVzID0gc2RwLnNwbGl0KCdcXG4nKTtcbiAgfVxuXG4gIGNvbnN0IGZtdHBMaW5lSW5kZXggPSBmaW5kRm10cExpbmUoc2RwTGluZXMsIGNvZGVjKTtcblxuICBsZXQgZm10cE9iaiA9IHt9O1xuICBpZiAoZm10cExpbmVJbmRleCA9PT0gbnVsbCkge1xuICAgIGNvbnN0IGluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdhPXJ0cG1hcCcsIGNvZGVjKTtcbiAgICBpZiAoaW5kZXggPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBzZHA7XG4gICAgfVxuICAgIGNvbnN0IHBheWxvYWQgPSBnZXRDb2RlY1BheWxvYWRUeXBlRnJvbUxpbmUoc2RwTGluZXNbaW5kZXhdKTtcbiAgICBmbXRwT2JqLnB0ID0gcGF5bG9hZC50b1N0cmluZygpO1xuICAgIGZtdHBPYmoucGFyYW1zID0ge307XG4gICAgZm10cE9iai5wYXJhbXNbcGFyYW1dID0gdmFsdWU7XG4gICAgc2RwTGluZXMuc3BsaWNlKGluZGV4ICsgMSwgMCwgd3JpdGVGbXRwTGluZShmbXRwT2JqKSk7XG4gIH0gZWxzZSB7XG4gICAgZm10cE9iaiA9IHBhcnNlRm10cExpbmUoc2RwTGluZXNbZm10cExpbmVJbmRleF0pO1xuICAgIGZtdHBPYmoucGFyYW1zW3BhcmFtXSA9IHZhbHVlO1xuICAgIHNkcExpbmVzW2ZtdHBMaW5lSW5kZXhdID0gd3JpdGVGbXRwTGluZShmbXRwT2JqKTtcbiAgfVxuXG4gIHNkcCA9IHNkcExpbmVzLmpvaW4oJ1xcclxcbicpO1xuICByZXR1cm4gc2RwO1xufVxuXG4vLyBSZW1vdmUgZm10cCBwYXJhbSBpZiBpdCBleGlzdHMuXG5mdW5jdGlvbiByZW1vdmVDb2RlY1BhcmFtKHNkcCwgY29kZWMsIHBhcmFtKSB7XG4gIGNvbnN0IHNkcExpbmVzID0gc2RwLnNwbGl0KCdcXHJcXG4nKTtcblxuICBjb25zdCBmbXRwTGluZUluZGV4ID0gZmluZEZtdHBMaW5lKHNkcExpbmVzLCBjb2RlYyk7XG4gIGlmIChmbXRwTGluZUluZGV4ID09PSBudWxsKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIGNvbnN0IG1hcCA9IHBhcnNlRm10cExpbmUoc2RwTGluZXNbZm10cExpbmVJbmRleF0pO1xuICBkZWxldGUgbWFwLnBhcmFtc1twYXJhbV07XG5cbiAgY29uc3QgbmV3TGluZSA9IHdyaXRlRm10cExpbmUobWFwKTtcbiAgaWYgKG5ld0xpbmUgPT09IG51bGwpIHtcbiAgICBzZHBMaW5lcy5zcGxpY2UoZm10cExpbmVJbmRleCwgMSk7XG4gIH0gZWxzZSB7XG4gICAgc2RwTGluZXNbZm10cExpbmVJbmRleF0gPSBuZXdMaW5lO1xuICB9XG5cbiAgc2RwID0gc2RwTGluZXMuam9pbignXFxyXFxuJyk7XG4gIHJldHVybiBzZHA7XG59XG5cbi8vIFNwbGl0IGFuIGZtdHAgbGluZSBpbnRvIGFuIG9iamVjdCBpbmNsdWRpbmcgJ3B0JyBhbmQgJ3BhcmFtcycuXG5mdW5jdGlvbiBwYXJzZUZtdHBMaW5lKGZtdHBMaW5lKSB7XG4gIGNvbnN0IGZtdHBPYmogPSB7fTtcbiAgY29uc3Qgc3BhY2VQb3MgPSBmbXRwTGluZS5pbmRleE9mKCcgJyk7XG4gIGNvbnN0IGtleVZhbHVlcyA9IGZtdHBMaW5lLnN1YnN0cmluZyhzcGFjZVBvcyArIDEpLnNwbGl0KCc7Jyk7XG5cbiAgY29uc3QgcGF0dGVybiA9IG5ldyBSZWdFeHAoJ2E9Zm10cDooXFxcXGQrKScpO1xuICBjb25zdCByZXN1bHQgPSBmbXRwTGluZS5tYXRjaChwYXR0ZXJuKTtcbiAgaWYgKHJlc3VsdCAmJiByZXN1bHQubGVuZ3RoID09PSAyKSB7XG4gICAgZm10cE9iai5wdCA9IHJlc3VsdFsxXTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHBhcmFtcyA9IHt9O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGtleVZhbHVlcy5sZW5ndGg7ICsraSkge1xuICAgIGNvbnN0IHBhaXIgPSBrZXlWYWx1ZXNbaV0uc3BsaXQoJz0nKTtcbiAgICBpZiAocGFpci5sZW5ndGggPT09IDIpIHtcbiAgICAgIHBhcmFtc1twYWlyWzBdXSA9IHBhaXJbMV07XG4gICAgfVxuICB9XG4gIGZtdHBPYmoucGFyYW1zID0gcGFyYW1zO1xuXG4gIHJldHVybiBmbXRwT2JqO1xufVxuXG4vLyBHZW5lcmF0ZSBhbiBmbXRwIGxpbmUgZnJvbSBhbiBvYmplY3QgaW5jbHVkaW5nICdwdCcgYW5kICdwYXJhbXMnLlxuZnVuY3Rpb24gd3JpdGVGbXRwTGluZShmbXRwT2JqKSB7XG4gIGlmICghZm10cE9iai5oYXNPd25Qcm9wZXJ0eSgncHQnKSB8fCAhZm10cE9iai5oYXNPd25Qcm9wZXJ0eSgncGFyYW1zJykpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBwdCA9IGZtdHBPYmoucHQ7XG4gIGNvbnN0IHBhcmFtcyA9IGZtdHBPYmoucGFyYW1zO1xuICBjb25zdCBrZXlWYWx1ZXMgPSBbXTtcbiAgbGV0IGkgPSAwO1xuICBmb3IgKGNvbnN0IGtleSBpbiBwYXJhbXMpIHtcbiAgICBrZXlWYWx1ZXNbaV0gPSBrZXkgKyAnPScgKyBwYXJhbXNba2V5XTtcbiAgICArK2k7XG4gIH1cbiAgaWYgKGkgPT09IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gJ2E9Zm10cDonICsgcHQudG9TdHJpbmcoKSArICcgJyArIGtleVZhbHVlcy5qb2luKCc7Jyk7XG59XG5cbi8vIEZpbmQgZm10cCBhdHRyaWJ1dGUgZm9yIHxjb2RlY3wgaW4gfHNkcExpbmVzfC5cbmZ1bmN0aW9uIGZpbmRGbXRwTGluZShzZHBMaW5lcywgY29kZWMpIHtcbiAgLy8gRmluZCBwYXlsb2FkIG9mIGNvZGVjLlxuICBjb25zdCBwYXlsb2FkID0gZ2V0Q29kZWNQYXlsb2FkVHlwZShzZHBMaW5lcywgY29kZWMpO1xuICAvLyBGaW5kIHRoZSBwYXlsb2FkIGluIGZtdHAgbGluZS5cbiAgcmV0dXJuIHBheWxvYWQgPyBmaW5kTGluZShzZHBMaW5lcywgJ2E9Zm10cDonICsgcGF5bG9hZC50b1N0cmluZygpKSA6IG51bGw7XG59XG5cbi8vIEZpbmQgdGhlIGxpbmUgaW4gc2RwTGluZXMgdGhhdCBzdGFydHMgd2l0aCB8cHJlZml4fCwgYW5kLCBpZiBzcGVjaWZpZWQsXG4vLyBjb250YWlucyB8c3Vic3RyfCAoY2FzZS1pbnNlbnNpdGl2ZSBzZWFyY2gpLlxuZnVuY3Rpb24gZmluZExpbmUoc2RwTGluZXMsIHByZWZpeCwgc3Vic3RyKSB7XG4gIHJldHVybiBmaW5kTGluZUluUmFuZ2Uoc2RwTGluZXMsIDAsIC0xLCBwcmVmaXgsIHN1YnN0cik7XG59XG5cbi8vIEZpbmQgdGhlIGxpbmUgaW4gc2RwTGluZXNbc3RhcnRMaW5lLi4uZW5kTGluZSAtIDFdIHRoYXQgc3RhcnRzIHdpdGggfHByZWZpeHxcbi8vIGFuZCwgaWYgc3BlY2lmaWVkLCBjb250YWlucyB8c3Vic3RyfCAoY2FzZS1pbnNlbnNpdGl2ZSBzZWFyY2gpLlxuZnVuY3Rpb24gZmluZExpbmVJblJhbmdlKHNkcExpbmVzLCBzdGFydExpbmUsIGVuZExpbmUsIHByZWZpeCwgc3Vic3RyKSB7XG4gIGNvbnN0IHJlYWxFbmRMaW5lID0gZW5kTGluZSAhPT0gLTEgPyBlbmRMaW5lIDogc2RwTGluZXMubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gc3RhcnRMaW5lOyBpIDwgcmVhbEVuZExpbmU7ICsraSkge1xuICAgIGlmIChzZHBMaW5lc1tpXS5pbmRleE9mKHByZWZpeCkgPT09IDApIHtcbiAgICAgIGlmICghc3Vic3RyIHx8XG4gICAgICAgICAgc2RwTGluZXNbaV0udG9Mb3dlckNhc2UoKS5pbmRleE9mKHN1YnN0ci50b0xvd2VyQ2FzZSgpKSAhPT0gLTEpIHtcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBHZXRzIHRoZSBjb2RlYyBwYXlsb2FkIHR5cGUgZnJvbSBzZHAgbGluZXMuXG5mdW5jdGlvbiBnZXRDb2RlY1BheWxvYWRUeXBlKHNkcExpbmVzLCBjb2RlYykge1xuICBjb25zdCBpbmRleCA9IGZpbmRMaW5lKHNkcExpbmVzLCAnYT1ydHBtYXAnLCBjb2RlYyk7XG4gIHJldHVybiBpbmRleCA/IGdldENvZGVjUGF5bG9hZFR5cGVGcm9tTGluZShzZHBMaW5lc1tpbmRleF0pIDogbnVsbDtcbn1cblxuLy8gR2V0cyB0aGUgY29kZWMgcGF5bG9hZCB0eXBlIGZyb20gYW4gYT1ydHBtYXA6WCBsaW5lLlxuZnVuY3Rpb24gZ2V0Q29kZWNQYXlsb2FkVHlwZUZyb21MaW5lKHNkcExpbmUpIHtcbiAgY29uc3QgcGF0dGVybiA9IG5ldyBSZWdFeHAoJ2E9cnRwbWFwOihcXFxcZCspIFthLXpBLVowLTktXStcXFxcL1xcXFxkKycpO1xuICBjb25zdCByZXN1bHQgPSBzZHBMaW5lLm1hdGNoKHBhdHRlcm4pO1xuICByZXR1cm4gKHJlc3VsdCAmJiByZXN1bHQubGVuZ3RoID09PSAyKSA/IHJlc3VsdFsxXSA6IG51bGw7XG59XG5cbi8vIFJldHVybnMgYSBuZXcgbT0gbGluZSB3aXRoIHRoZSBzcGVjaWZpZWQgY29kZWMgYXMgdGhlIGZpcnN0IG9uZS5cbmZ1bmN0aW9uIHNldERlZmF1bHRDb2RlYyhtTGluZSwgcGF5bG9hZCkge1xuICBjb25zdCBlbGVtZW50cyA9IG1MaW5lLnNwbGl0KCcgJyk7XG5cbiAgLy8gSnVzdCBjb3B5IHRoZSBmaXJzdCB0aHJlZSBwYXJhbWV0ZXJzOyBjb2RlYyBvcmRlciBzdGFydHMgb24gZm91cnRoLlxuICBjb25zdCBuZXdMaW5lID0gZWxlbWVudHMuc2xpY2UoMCwgMyk7XG5cbiAgLy8gUHV0IHRhcmdldCBwYXlsb2FkIGZpcnN0IGFuZCBjb3B5IGluIHRoZSByZXN0LlxuICBuZXdMaW5lLnB1c2gocGF5bG9hZCk7XG4gIGZvciAobGV0IGkgPSAzOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZWxlbWVudHNbaV0gIT09IHBheWxvYWQpIHtcbiAgICAgIG5ld0xpbmUucHVzaChlbGVtZW50c1tpXSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXdMaW5lLmpvaW4oJyAnKTtcbn1cblxuLyogQmVsb3cgYXJlIG5ld2x5IGFkZGVkIGZ1bmN0aW9ucyAqL1xuXG4vLyBGb2xsb3dpbmcgY29kZWNzIHdpbGwgbm90IGJlIHJlbW92ZWQgZnJvbSBTRFAgZXZlbnQgdGhleSBhcmUgbm90IGluIHRoZVxuLy8gdXNlci1zcGVjaWZpZWQgY29kZWMgbGlzdC5cbmNvbnN0IGF1ZGlvQ29kZWNXaGl0ZUxpc3QgPSBbJ0NOJywgJ3RlbGVwaG9uZS1ldmVudCddO1xuY29uc3QgdmlkZW9Db2RlY1doaXRlTGlzdCA9IFsncmVkJywgJ3VscGZlYyddO1xuXG4vLyBSZXR1cm5zIGEgbmV3IG09IGxpbmUgd2l0aCB0aGUgc3BlY2lmaWVkIGNvZGVjIG9yZGVyLlxuZnVuY3Rpb24gc2V0Q29kZWNPcmRlcihtTGluZSwgcGF5bG9hZHMpIHtcbiAgY29uc3QgZWxlbWVudHMgPSBtTGluZS5zcGxpdCgnICcpO1xuXG4gIC8vIEp1c3QgY29weSB0aGUgZmlyc3QgdGhyZWUgcGFyYW1ldGVyczsgY29kZWMgb3JkZXIgc3RhcnRzIG9uIGZvdXJ0aC5cbiAgbGV0IG5ld0xpbmUgPSBlbGVtZW50cy5zbGljZSgwLCAzKTtcblxuICAvLyBDb25jYXQgcGF5bG9hZCB0eXBlcy5cbiAgbmV3TGluZSA9IG5ld0xpbmUuY29uY2F0KHBheWxvYWRzKTtcblxuICByZXR1cm4gbmV3TGluZS5qb2luKCcgJyk7XG59XG5cbi8vIEFwcGVuZCBSVFggcGF5bG9hZHMgZm9yIGV4aXN0aW5nIHBheWxvYWRzLlxuZnVuY3Rpb24gYXBwZW5kUnR4UGF5bG9hZHMoc2RwTGluZXMsIHBheWxvYWRzKSB7XG4gIGZvciAoY29uc3QgcGF5bG9hZCBvZiBwYXlsb2Fkcykge1xuICAgIGNvbnN0IGluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdhPWZtdHAnLCAnYXB0PScgKyBwYXlsb2FkKTtcbiAgICBpZiAoaW5kZXggIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IGZtdHBMaW5lID0gcGFyc2VGbXRwTGluZShzZHBMaW5lc1tpbmRleF0pO1xuICAgICAgcGF5bG9hZHMucHVzaChmbXRwTGluZS5wdCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwYXlsb2Fkcztcbn1cblxuLy8gUmVtb3ZlIGEgY29kZWMgd2l0aCBhbGwgaXRzIGFzc29jaWF0ZWQgYSBsaW5lcy5cbmZ1bmN0aW9uIHJlbW92ZUNvZGVjRnJhbUFMaW5lKHNkcExpbmVzLCBwYXlsb2FkKSB7XG4gIGNvbnN0IHBhdHRlcm4gPSBuZXcgUmVnRXhwKCdhPShydHBtYXB8cnRjcC1mYnxmbXRwKTonK3BheWxvYWQrJ1xcXFxzJyk7XG4gIGZvciAobGV0IGk9c2RwTGluZXMubGVuZ3RoLTE7IGk+MDsgaS0tKSB7XG4gICAgaWYgKHNkcExpbmVzW2ldLm1hdGNoKHBhdHRlcm4pKSB7XG4gICAgICBzZHBMaW5lcy5zcGxpY2UoaSwgMSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzZHBMaW5lcztcbn1cblxuLy8gUmVvcmRlciBjb2RlY3MgaW4gbS1saW5lIGFjY29yZGluZyB0aGUgb3JkZXIgb2YgfGNvZGVjc3wuIFJlbW92ZSBjb2RlY3MgZnJvbVxuLy8gbS1saW5lIGlmIGl0IGlzIG5vdCBwcmVzZW50IGluIHxjb2RlY3N8XG4vLyBUaGUgZm9ybWF0IG9mIHxjb2RlY3wgaXMgJ05BTUUvUkFURScsIGUuZy4gJ29wdXMvNDgwMDAnLlxuZXhwb3J0IGZ1bmN0aW9uIHJlb3JkZXJDb2RlY3Moc2RwLCB0eXBlLCBjb2RlY3MpIHtcbiAgaWYgKCFjb2RlY3MgfHwgY29kZWNzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICBjb2RlY3MgPSB0eXBlID09PSAnYXVkaW8nID8gY29kZWNzLmNvbmNhdChhdWRpb0NvZGVjV2hpdGVMaXN0KSA6IGNvZGVjcy5jb25jYXQoXG4gICAgICB2aWRlb0NvZGVjV2hpdGVMaXN0KTtcblxuICBsZXQgc2RwTGluZXMgPSBzZHAuc3BsaXQoJ1xcclxcbicpO1xuXG4gIC8vIFNlYXJjaCBmb3IgbSBsaW5lLlxuICBjb25zdCBtTGluZUluZGV4ID0gZmluZExpbmUoc2RwTGluZXMsICdtPScsIHR5cGUpO1xuICBpZiAobUxpbmVJbmRleCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICBjb25zdCBvcmlnaW5QYXlsb2FkcyA9IHNkcExpbmVzW21MaW5lSW5kZXhdLnNwbGl0KCcgJyk7XG4gIG9yaWdpblBheWxvYWRzLnNwbGljZSgwLCAzKTtcblxuICAvLyBJZiB0aGUgY29kZWMgaXMgYXZhaWxhYmxlLCBzZXQgaXQgYXMgdGhlIGRlZmF1bHQgaW4gbSBsaW5lLlxuICBsZXQgcGF5bG9hZHMgPSBbXTtcbiAgZm9yIChjb25zdCBjb2RlYyBvZiBjb2RlY3MpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNkcExpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBpbmRleCA9IGZpbmRMaW5lSW5SYW5nZShzZHBMaW5lcywgaSwgLTEsICdhPXJ0cG1hcCcsIGNvZGVjKTtcbiAgICAgIGlmIChpbmRleCAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBwYXlsb2FkID0gZ2V0Q29kZWNQYXlsb2FkVHlwZUZyb21MaW5lKHNkcExpbmVzW2luZGV4XSk7XG4gICAgICAgIGlmIChwYXlsb2FkKSB7XG4gICAgICAgICAgcGF5bG9hZHMucHVzaChwYXlsb2FkKTtcbiAgICAgICAgICBpID0gaW5kZXg7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcGF5bG9hZHMgPSBhcHBlbmRSdHhQYXlsb2FkcyhzZHBMaW5lcywgcGF5bG9hZHMpO1xuICBzZHBMaW5lc1ttTGluZUluZGV4XSA9IHNldENvZGVjT3JkZXIoc2RwTGluZXNbbUxpbmVJbmRleF0sIHBheWxvYWRzKTtcblxuICAvLyBSZW1vdmUgYSBsaW5lcy5cbiAgZm9yIChjb25zdCBwYXlsb2FkIG9mIG9yaWdpblBheWxvYWRzKSB7XG4gICAgaWYgKHBheWxvYWRzLmluZGV4T2YocGF5bG9hZCk9PT0tMSkge1xuICAgICAgc2RwTGluZXMgPSByZW1vdmVDb2RlY0ZyYW1BTGluZShzZHBMaW5lcywgcGF5bG9hZCk7XG4gICAgfVxuICB9XG5cbiAgc2RwID0gc2RwTGluZXMuam9pbignXFxyXFxuJyk7XG4gIHJldHVybiBzZHA7XG59XG5cbi8vIEFkZCBsZWdhY3kgc2ltdWxjYXN0LlxuZXhwb3J0IGZ1bmN0aW9uIGFkZExlZ2FjeVNpbXVsY2FzdChzZHAsIHR5cGUsIG51bVN0cmVhbXMpIHtcbiAgaWYgKCFudW1TdHJlYW1zIHx8ICEobnVtU3RyZWFtcyA+IDEpKSB7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIGxldCBzZHBMaW5lcyA9IHNkcC5zcGxpdCgnXFxyXFxuJyk7XG4gIC8vIFNlYXJjaCBmb3IgbSBsaW5lLlxuICBjb25zdCBtTGluZVN0YXJ0ID0gZmluZExpbmUoc2RwTGluZXMsICdtPScsIHR5cGUpO1xuICBpZiAobUxpbmVTdGFydCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBzZHA7XG4gIH1cbiAgbGV0IG1MaW5lRW5kID0gZmluZExpbmVJblJhbmdlKHNkcExpbmVzLCBtTGluZVN0YXJ0ICsgMSwgLTEsICdtPScpO1xuICBpZiAobUxpbmVFbmQgPT09IG51bGwpIHtcbiAgICBtTGluZUVuZCA9IHNkcExpbmVzLmxlbmd0aDtcbiAgfVxuXG4gIGNvbnN0IHNzcmNHZXR0ZXIgPSAobGluZSkgPT4ge1xuICAgIGNvbnN0IHBhcnRzID0gbGluZS5zcGxpdCgnICcpO1xuICAgIGNvbnN0IHNzcmMgPSBwYXJ0c1swXS5zcGxpdCgnOicpWzFdO1xuICAgIHJldHVybiBzc3JjO1xuICB9O1xuXG4gIC8vIFByb2Nlc3Mgc3NyYyBsaW5lcyBmcm9tIG1MaW5lSW5kZXguXG4gIGNvbnN0IHJlbW92ZXMgPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHNzcmNzID0gbmV3IFNldCgpO1xuICBjb25zdCBnc3NyY3MgPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHNpbUxpbmVzID0gW107XG4gIGNvbnN0IHNpbUdyb3VwTGluZXMgPSBbXTtcbiAgbGV0IGkgPSBtTGluZVN0YXJ0ICsgMTtcbiAgd2hpbGUgKGkgPCBtTGluZUVuZCkge1xuICAgIGNvbnN0IGxpbmUgPSBzZHBMaW5lc1tpXTtcbiAgICBpZiAobGluZSA9PT0gJycpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAobGluZS5pbmRleE9mKCdhPXNzcmM6JykgPiAtMSkge1xuICAgICAgY29uc3Qgc3NyYyA9IHNzcmNHZXR0ZXIoc2RwTGluZXNbaV0pO1xuICAgICAgc3NyY3MuYWRkKHNzcmMpO1xuICAgICAgaWYgKGxpbmUuaW5kZXhPZignY25hbWUnKSA+IC0xIHx8IGxpbmUuaW5kZXhPZignbXNpZCcpID4gLTEpIHtcbiAgICAgICAgZm9yIChsZXQgaiA9IDE7IGogPCBudW1TdHJlYW1zOyBqKyspIHtcbiAgICAgICAgICBjb25zdCBuc3NyYyA9IChwYXJzZUludChzc3JjKSArIGopICsgJyc7XG4gICAgICAgICAgc2ltTGluZXMucHVzaChsaW5lLnJlcGxhY2Uoc3NyYywgbnNzcmMpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVtb3Zlcy5hZGQobGluZSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChsaW5lLmluZGV4T2YoJ2E9c3NyYy1ncm91cDpGSUQnKSA+IC0xKSB7XG4gICAgICBjb25zdCBwYXJ0cyA9IGxpbmUuc3BsaXQoJyAnKTtcbiAgICAgIGdzc3Jjcy5hZGQocGFydHNbMl0pO1xuICAgICAgZm9yIChsZXQgaiA9IDE7IGogPCBudW1TdHJlYW1zOyBqKyspIHtcbiAgICAgICAgY29uc3QgbnNzcmMxID0gKHBhcnNlSW50KHBhcnRzWzFdKSArIGopICsgJyc7XG4gICAgICAgIGNvbnN0IG5zc3JjMiA9IChwYXJzZUludChwYXJ0c1syXSkgKyBqKSArICcnO1xuICAgICAgICBzaW1Hcm91cExpbmVzLnB1c2goXG4gICAgICAgICAgbGluZS5yZXBsYWNlKHBhcnRzWzFdLCBuc3NyYzEpLnJlcGxhY2UocGFydHNbMl0sIG5zc3JjMikpO1xuICAgICAgfVxuICAgIH1cbiAgICBpKys7XG4gIH1cblxuICBjb25zdCBpbnNlcnRQb3MgPSBpO1xuICBzc3Jjcy5mb3JFYWNoKHNzcmMgPT4ge1xuICAgIGlmICghZ3NzcmNzLmhhcyhzc3JjKSkge1xuICAgICAgbGV0IGdyb3VwTGluZSA9ICdhPXNzcmMtZ3JvdXA6U0lNJztcbiAgICAgIGdyb3VwTGluZSA9IGdyb3VwTGluZSArICcgJyArIHNzcmM7XG4gICAgICBmb3IgKGxldCBqID0gMTsgaiA8IG51bVN0cmVhbXM7IGorKykge1xuICAgICAgICBncm91cExpbmUgPSBncm91cExpbmUgKyAnICcgKyAocGFyc2VJbnQoc3NyYykgKyBqKTtcbiAgICAgIH1cbiAgICAgIHNpbUdyb3VwTGluZXMucHVzaChncm91cExpbmUpO1xuICAgIH1cbiAgfSk7XG5cbiAgc2ltTGluZXMuc29ydCgpO1xuICAvLyBJbnNlcnQgc2ltdWxjYXN0IHNzcmMgbGluZXMuXG4gIHNkcExpbmVzLnNwbGljZShpbnNlcnRQb3MsIDAsIC4uLnNpbUdyb3VwTGluZXMpO1xuICBzZHBMaW5lcy5zcGxpY2UoaW5zZXJ0UG9zLCAwLCAuLi5zaW1MaW5lcyk7XG4gIHNkcExpbmVzID0gc2RwTGluZXMuZmlsdGVyKGxpbmUgPT4gIXJlbW92ZXMuaGFzKGxpbmUpKTtcblxuICBzZHAgPSBzZHBMaW5lcy5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIHNkcDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldE1heEJpdHJhdGUoc2RwLCBlbmNvZGluZ1BhcmFtZXRlcnNMaXN0KSB7XG4gIGZvciAoY29uc3QgZW5jb2RpbmdQYXJhbWV0ZXJzIG9mIGVuY29kaW5nUGFyYW1ldGVyc0xpc3QpIHtcbiAgICBpZiAoZW5jb2RpbmdQYXJhbWV0ZXJzLm1heEJpdHJhdGUpIHtcbiAgICAgIHNkcCA9IHNldENvZGVjUGFyYW0oXG4gICAgICAgICAgc2RwLCBlbmNvZGluZ1BhcmFtZXRlcnMuY29kZWMubmFtZSwgJ3gtZ29vZ2xlLW1heC1iaXRyYXRlJyxcbiAgICAgICAgICAoZW5jb2RpbmdQYXJhbWV0ZXJzLm1heEJpdHJhdGUpLnRvU3RyaW5nKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc2RwO1xufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4ndXNlIHN0cmljdCc7XG5pbXBvcnQgTG9nZ2VyIGZyb20gJy4vbG9nZ2VyLmpzJ1xuaW1wb3J0IHtPd3RFdmVudH0gZnJvbSAnLi9ldmVudC5qcydcbmltcG9ydCAqIGFzIFV0aWxzIGZyb20gJy4vdXRpbHMuanMnXG5pbXBvcnQgeyBFdmVudERpc3BhdGNoZXJ9IGZyb20gJy4vZXZlbnQuanMnO1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuZnVuY3Rpb24gaXNBbGxvd2VkVmFsdWUob2JqLCBhbGxvd2VkVmFsdWVzKSB7XG4gIHJldHVybiAoYWxsb3dlZFZhbHVlcy5zb21lKChlbGUpID0+IHtcbiAgICByZXR1cm4gZWxlID09PSBvYmo7XG4gIH0pKTtcbn1cbi8qKlxuICogQGNsYXNzIFN0cmVhbVNvdXJjZUluZm9cbiAqIEBtZW1iZXJPZiBPd3QuQmFzZVxuICogQGNsYXNzRGVzYyBJbmZvcm1hdGlvbiBvZiBhIHN0cmVhbSdzIHNvdXJjZS5cbiAqIEBjb25zdHJ1Y3RvclxuICogQGRlc2NyaXB0aW9uIEF1ZGlvIHNvdXJjZSBpbmZvIG9yIHZpZGVvIHNvdXJjZSBpbmZvIGNvdWxkIGJlIHVuZGVmaW5lZCBpZiBhIHN0cmVhbSBkb2VzIG5vdCBoYXZlIGF1ZGlvL3ZpZGVvIHRyYWNrLlxuICogQHBhcmFtIHs/c3RyaW5nfSBhdWRpb1NvdXJjZUluZm8gQXVkaW8gc291cmNlIGluZm8uIEFjY2VwdGVkIHZhbHVlcyBhcmU6IFwibWljXCIsIFwic2NyZWVuLWNhc3RcIiwgXCJmaWxlXCIsIFwibWl4ZWRcIiBvciB1bmRlZmluZWQuXG4gKiBAcGFyYW0gez9zdHJpbmd9IHZpZGVvU291cmNlSW5mbyBWaWRlbyBzb3VyY2UgaW5mby4gQWNjZXB0ZWQgdmFsdWVzIGFyZTogXCJjYW1lcmFcIiwgXCJzY3JlZW4tY2FzdFwiLCBcImZpbGVcIiwgXCJtaXhlZFwiIG9yIHVuZGVmaW5lZC5cbiAqL1xuZXhwb3J0IGNsYXNzIFN0cmVhbVNvdXJjZUluZm8ge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihhdWRpb1NvdXJjZUluZm8sIHZpZGVvU291cmNlSW5mbykge1xuICAgIGlmICghaXNBbGxvd2VkVmFsdWUoYXVkaW9Tb3VyY2VJbmZvLCBbdW5kZWZpbmVkLCAnbWljJywgJ3NjcmVlbi1jYXN0JyxcbiAgICAgICdmaWxlJywgJ21peGVkJ10pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbmNvcnJlY3QgdmFsdWUgZm9yIGF1ZGlvU291cmNlSW5mbycpO1xuICAgIH1cbiAgICBpZiAoIWlzQWxsb3dlZFZhbHVlKHZpZGVvU291cmNlSW5mbywgW3VuZGVmaW5lZCwgJ2NhbWVyYScsICdzY3JlZW4tY2FzdCcsXG4gICAgICAnZmlsZScsICdlbmNvZGVkLWZpbGUnLCAncmF3LWZpbGUnLCAnbWl4ZWQnXSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0luY29ycmVjdCB2YWx1ZSBmb3IgdmlkZW9Tb3VyY2VJbmZvJyk7XG4gICAgfVxuICAgIHRoaXMuYXVkaW8gPSBhdWRpb1NvdXJjZUluZm87XG4gICAgdGhpcy52aWRlbyA9IHZpZGVvU291cmNlSW5mbztcbiAgfVxufVxuLyoqXG4gKiBAY2xhc3MgU3RyZWFtXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBjbGFzc0Rlc2MgQmFzZSBjbGFzcyBvZiBzdHJlYW1zLlxuICogQGV4dGVuZHMgT3d0LkJhc2UuRXZlbnREaXNwYXRjaGVyXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBTdHJlYW0gZXh0ZW5kcyBFdmVudERpc3BhdGNoZXIge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihzdHJlYW0sIHNvdXJjZUluZm8sIGF0dHJpYnV0ZXMpIHtcbiAgICBzdXBlcigpO1xuICAgIGlmICgoc3RyZWFtICYmICEoc3RyZWFtIGluc3RhbmNlb2YgTWVkaWFTdHJlYW0pKSB8fCAodHlwZW9mIHNvdXJjZUluZm8gIT09XG4gICAgICAgICdvYmplY3QnKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzdHJlYW0gb3Igc291cmNlSW5mby4nKTtcbiAgICB9XG4gICAgaWYgKHN0cmVhbSAmJiAoKHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmxlbmd0aCA+IDAgJiYgIXNvdXJjZUluZm8uYXVkaW8pIHx8XG4gICAgICAgIHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmxlbmd0aCA+IDAgJiYgIXNvdXJjZUluZm8udmlkZW8pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNaXNzaW5nIGF1ZGlvIHNvdXJjZSBpbmZvIG9yIHZpZGVvIHNvdXJjZSBpbmZvLicpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/TWVkaWFTdHJlYW19IG1lZGlhU3RyZWFtXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlN0cmVhbVxuICAgICAqIEBzZWUge0BsaW5rIGh0dHBzOi8vd3d3LnczLm9yZy9UUi9tZWRpYWNhcHR1cmUtc3RyZWFtcy8jbWVkaWFzdHJlYW18TWVkaWFTdHJlYW0gQVBJIG9mIE1lZGlhIENhcHR1cmUgYW5kIFN0cmVhbXN9LlxuICAgICAqL1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAnbWVkaWFTdHJlYW0nLCB7XG4gICAgICBjb25maWd1cmFibGU6IGZhbHNlLFxuICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICB2YWx1ZTogc3RyZWFtLFxuICAgIH0pO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge093dC5CYXNlLlN0cmVhbVNvdXJjZUluZm99IHNvdXJjZVxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5TdHJlYW1cbiAgICAgKiBAZGVzYyBTb3VyY2UgaW5mbyBvZiBhIHN0cmVhbS5cbiAgICAgKi9cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3NvdXJjZScsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICB2YWx1ZTogc291cmNlSW5mbyxcbiAgICB9KTtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtvYmplY3R9IGF0dHJpYnV0ZXNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuU3RyZWFtXG4gICAgICogQGRlc2MgQ3VzdG9tIGF0dHJpYnV0ZXMgb2YgYSBzdHJlYW0uXG4gICAgICovXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdhdHRyaWJ1dGVzJywge1xuICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgdmFsdWU6IGF0dHJpYnV0ZXMsXG4gICAgfSk7XG4gIH1cbn1cbi8qKlxuICogQGNsYXNzIExvY2FsU3RyZWFtXG4gKiBAY2xhc3NEZXNjIFN0cmVhbSBjYXB0dXJlZCBmcm9tIGN1cnJlbnQgZW5kcG9pbnQuXG4gKiBAbWVtYmVyT2YgT3d0LkJhc2VcbiAqIEBleHRlbmRzIE93dC5CYXNlLlN0cmVhbVxuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge01lZGlhU3RyZWFtfSBzdHJlYW0gVW5kZXJseWluZyBNZWRpYVN0cmVhbS5cbiAqIEBwYXJhbSB7T3d0LkJhc2UuU3RyZWFtU291cmNlSW5mb30gc291cmNlSW5mbyBJbmZvcm1hdGlvbiBhYm91dCBzdHJlYW0ncyBzb3VyY2UuXG4gKiBAcGFyYW0ge29iamVjdH0gYXR0cmlidXRlcyBDdXN0b20gYXR0cmlidXRlcyBvZiB0aGUgc3RyZWFtLlxuICovXG5leHBvcnQgY2xhc3MgTG9jYWxTdHJlYW0gZXh0ZW5kcyBTdHJlYW0ge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihzdHJlYW0sIHNvdXJjZUluZm8sIGF0dHJpYnV0ZXMpIHtcbiAgICBpZiAoIShzdHJlYW0gaW5zdGFuY2VvZiBNZWRpYVN0cmVhbSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgc3RyZWFtLicpO1xuICAgIH1cbiAgICBzdXBlcihzdHJlYW0sIHNvdXJjZUluZm8sIGF0dHJpYnV0ZXMpO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gaWRcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuTG9jYWxTdHJlYW1cbiAgICAgKi9cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ2lkJywge1xuICAgICAgY29uZmlndXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgIHZhbHVlOiBVdGlscy5jcmVhdGVVdWlkKCksXG4gICAgfSk7XG4gIH1cbn1cbi8qKlxuICogQGNsYXNzIFJlbW90ZVN0cmVhbVxuICogQGNsYXNzRGVzYyBTdHJlYW0gc2VudCBmcm9tIGEgcmVtb3RlIGVuZHBvaW50LlxuICogRXZlbnRzOlxuICpcbiAqIHwgRXZlbnQgTmFtZSAgICAgIHwgQXJndW1lbnQgVHlwZSAgICB8IEZpcmVkIHdoZW4gICAgICAgICB8XG4gKiB8IC0tLS0tLS0tLS0tLS0tLS18IC0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tLS0gfFxuICogfCBlbmRlZCAgICAgICAgICAgfCBFdmVudCAgICAgICAgICAgIHwgU3RyZWFtIGlzIGVuZGVkLiAgIHxcbiAqIHwgdXBkYXRlZCAgICAgICAgIHwgRXZlbnQgICAgICAgICAgICB8IFN0cmVhbSBpcyB1cGRhdGVkLiB8XG4gKlxuICogQG1lbWJlck9mIE93dC5CYXNlXG4gKiBAZXh0ZW5kcyBPd3QuQmFzZS5TdHJlYW1cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFJlbW90ZVN0cmVhbSBleHRlbmRzIFN0cmVhbSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGlkLCBvcmlnaW4sIHN0cmVhbSwgc291cmNlSW5mbywgYXR0cmlidXRlcykge1xuICAgIHN1cGVyKHN0cmVhbSwgc291cmNlSW5mbywgYXR0cmlidXRlcyk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBpZFxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5SZW1vdGVTdHJlYW1cbiAgICAgKi9cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ2lkJywge1xuICAgICAgY29uZmlndXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgIHZhbHVlOiBpZCA/IGlkIDogVXRpbHMuY3JlYXRlVXVpZCgpLFxuICAgIH0pO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gb3JpZ2luXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlJlbW90ZVN0cmVhbVxuICAgICAqIEBkZXNjIElEIG9mIHRoZSByZW1vdGUgZW5kcG9pbnQgd2hvIHB1Ymxpc2hlZCB0aGlzIHN0cmVhbS5cbiAgICAgKi9cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ29yaWdpbicsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICB2YWx1ZTogb3JpZ2luLFxuICAgIH0pO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge093dC5CYXNlLlB1YmxpY2F0aW9uU2V0dGluZ3N9IHNldHRpbmdzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5CYXNlLlJlbW90ZVN0cmVhbVxuICAgICAqIEBkZXNjIE9yaWdpbmFsIHNldHRpbmdzIGZvciBwdWJsaXNoaW5nIHRoaXMgc3RyZWFtLiBUaGlzIHByb3BlcnR5IGlzIG9ubHkgdmFsaWQgaW4gY29uZmVyZW5jZSBtb2RlLlxuICAgICAqL1xuICAgIHRoaXMuc2V0dGluZ3MgPSB1bmRlZmluZWQ7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7T3d0LkNvbmZlcmVuY2UuU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzfSBleHRyYUNhcGFiaWxpdGllc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQmFzZS5SZW1vdGVTdHJlYW1cbiAgICAgKiBAZGVzYyBFeHRyYSBjYXBhYmlsaXRpZXMgcmVtb3RlIGVuZHBvaW50IHByb3ZpZGVzIGZvciBzdWJzY3JpcHRpb24uIEV4dHJhIGNhcGFiaWxpdGllcyBkb24ndCBpbmNsdWRlIG9yaWdpbmFsIHNldHRpbmdzLiBUaGlzIHByb3BlcnR5IGlzIG9ubHkgdmFsaWQgaW4gY29uZmVyZW5jZSBtb2RlLlxuICAgICAqL1xuICAgIHRoaXMuZXh0cmFDYXBhYmlsaXRpZXMgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgU3RyZWFtRXZlbnRcbiAqIEBjbGFzc0Rlc2MgRXZlbnQgZm9yIFN0cmVhbS5cbiAqIEBleHRlbmRzIE93dC5CYXNlLk93dEV2ZW50XG4gKiBAbWVtYmVyb2YgT3d0LkJhc2VcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFN0cmVhbUV2ZW50IGV4dGVuZHMgT3d0RXZlbnQge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcih0eXBlLCBpbml0KSB7XG4gICAgc3VwZXIodHlwZSk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7T3d0LkJhc2UuU3RyZWFtfSBzdHJlYW1cbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkJhc2UuU3RyZWFtRXZlbnRcbiAgICAgKi9cbiAgICB0aGlzLnN0cmVhbSA9IGluaXQuc3RyZWFtO1xuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8qIGdsb2JhbCBuYXZpZ2F0b3IsIHdpbmRvdyAqL1xuXG4ndXNlIHN0cmljdCc7XG5jb25zdCBzZGtWZXJzaW9uID0gJzQuMy4xJztcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbmV4cG9ydCBmdW5jdGlvbiBpc0ZpcmVmb3goKSB7XG4gIHJldHVybiB3aW5kb3cubmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgnRmlyZWZveCcpICE9PSBudWxsO1xufVxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbmV4cG9ydCBmdW5jdGlvbiBpc0Nocm9tZSgpIHtcbiAgcmV0dXJuIHdpbmRvdy5uYXZpZ2F0b3IudXNlckFnZW50Lm1hdGNoKCdDaHJvbWUnKSAhPT0gbnVsbDtcbn1cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG5leHBvcnQgZnVuY3Rpb24gaXNTYWZhcmkoKSB7XG4gIFxuICByZXR1cm4gL14oKD8hY2hyb21lfGFuZHJvaWQpLikqc2FmYXJpL2kudGVzdCh3aW5kb3cubmF2aWdhdG9yLnVzZXJBZ2VudCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1RhdXJpKCkge1xuICByZXR1cm4gd2luZG93Ll9fVEFVUklfSVBDX19cbn1cbi8vIGV4cG9ydCBmdW5jdGlvbiBpc1NhZmFyaSgpIHtcbi8vICAgcmV0dXJuIHRydWU7XG4vLyB9XG5cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbmV4cG9ydCBmdW5jdGlvbiBpc0VkZ2UoKSB7XG4gIHJldHVybiB3aW5kb3cubmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvRWRnZVxcLyhcXGQrKS4oXFxkKykkLykgIT09IG51bGw7XG59XG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVV1aWQoKSB7XG4gIHJldHVybiAneHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHgnLnJlcGxhY2UoL1t4eV0vZywgZnVuY3Rpb24oYykge1xuICAgIGNvbnN0IHIgPSBNYXRoLnJhbmRvbSgpICogMTYgfCAwO1xuICAgIGNvbnN0IHYgPSBjID09PSAneCcgPyByIDogKHIgJiAweDMgfCAweDgpO1xuICAgIHJldHVybiB2LnRvU3RyaW5nKDE2KTtcbiAgfSk7XG59XG5cbi8vIFJldHVybnMgc3lzdGVtIGluZm9ybWF0aW9uLlxuLy8gRm9ybWF0OiB7c2RrOnt2ZXJzaW9uOioqLCB0eXBlOioqfSwgcnVudGltZTp7dmVyc2lvbjoqKiwgbmFtZToqKn0sIG9zOnt2ZXJzaW9uOioqLCBuYW1lOioqfX07XG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuZXhwb3J0IGZ1bmN0aW9uIHN5c0luZm8oKSB7XG4gIGNvbnN0IGluZm8gPSBPYmplY3QuY3JlYXRlKHt9KTtcbiAgaW5mby5zZGsgPSB7XG4gICAgdmVyc2lvbjogc2RrVmVyc2lvbixcbiAgICB0eXBlOiAnSmF2YVNjcmlwdCcsXG4gIH07XG4gIC8vIFJ1bnRpbWUgaW5mby5cbiAgY29uc3QgdXNlckFnZW50ID0gbmF2aWdhdG9yLnVzZXJBZ2VudDtcbiAgY29uc3QgZmlyZWZveFJlZ2V4ID0gL0ZpcmVmb3hcXC8oWzAtOVxcLl0rKS87XG4gIGNvbnN0IGNocm9tZVJlZ2V4ID0gL0Nocm9tZVxcLyhbMC05XFwuXSspLztcbiAgY29uc3QgZWRnZVJlZ2V4ID0gL0VkZ2VcXC8oWzAtOVxcLl0rKS87XG4gIGNvbnN0IHNhZmFyaVZlcnNpb25SZWdleCA9IC9WZXJzaW9uXFwvKFswLTlcXC5dKykgU2FmYXJpLztcbiAgbGV0IHJlc3VsdCA9IGNocm9tZVJlZ2V4LmV4ZWModXNlckFnZW50KTtcbiAgaWYgKHJlc3VsdCkge1xuICAgIGluZm8ucnVudGltZSA9IHtcbiAgICAgIG5hbWU6ICdDaHJvbWUnLFxuICAgICAgdmVyc2lvbjogcmVzdWx0WzFdLFxuICAgIH07XG4gIH0gZWxzZSBpZiAocmVzdWx0ID0gZmlyZWZveFJlZ2V4LmV4ZWModXNlckFnZW50KSkge1xuICAgIGluZm8ucnVudGltZSA9IHtcbiAgICAgIG5hbWU6ICdGaXJlZm94JyxcbiAgICAgIHZlcnNpb246IHJlc3VsdFsxXSxcbiAgICB9O1xuICB9IGVsc2UgaWYgKHJlc3VsdCA9IGVkZ2VSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLnJ1bnRpbWUgPSB7XG4gICAgICBuYW1lOiAnRWRnZScsXG4gICAgICB2ZXJzaW9uOiByZXN1bHRbMV0sXG4gICAgfTtcbiAgfSBlbHNlIGlmIChpc1NhZmFyaSgpKSB7XG4gICAgcmVzdWx0ID0gc2FmYXJpVmVyc2lvblJlZ2V4LmV4ZWModXNlckFnZW50KTtcbiAgICBpbmZvLnJ1bnRpbWUgPSB7XG4gICAgICBuYW1lOiAnU2FmYXJpJyxcbiAgICB9O1xuICAgIGluZm8ucnVudGltZS52ZXJzaW9uID0gcmVzdWx0ID8gcmVzdWx0WzFdIDogJ1Vua25vd24nO1xuICB9IGVsc2Uge1xuICAgIGluZm8ucnVudGltZSA9IHtcbiAgICAgIG5hbWU6ICdVbmtub3duJyxcbiAgICAgIHZlcnNpb246ICdVbmtub3duJyxcbiAgICB9O1xuICB9XG4gIC8vIE9TIGluZm8uXG4gIGNvbnN0IHdpbmRvd3NSZWdleCA9IC9XaW5kb3dzIE5UIChbMC05XFwuXSspLztcbiAgY29uc3QgbWFjUmVnZXggPSAvSW50ZWwgTWFjIE9TIFggKFswLTlfXFwuXSspLztcbiAgY29uc3QgaVBob25lUmVnZXggPSAvaVBob25lIE9TIChbMC05X1xcLl0rKS87XG4gIGNvbnN0IGxpbnV4UmVnZXggPSAvWDExOyBMaW51eC87XG4gIGNvbnN0IGFuZHJvaWRSZWdleCA9IC9BbmRyb2lkKCAoWzAtOVxcLl0rKSk/LztcbiAgY29uc3QgY2hyb21pdW1Pc1JlZ2V4ID0gL0NyT1MvO1xuICBpZiAocmVzdWx0ID0gd2luZG93c1JlZ2V4LmV4ZWModXNlckFnZW50KSkge1xuICAgIGluZm8ub3MgPSB7XG4gICAgICBuYW1lOiAnV2luZG93cyBOVCcsXG4gICAgICB2ZXJzaW9uOiByZXN1bHRbMV0sXG4gICAgfTtcbiAgfSBlbHNlIGlmIChyZXN1bHQgPSBtYWNSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ01hYyBPUyBYJyxcbiAgICAgIHZlcnNpb246IHJlc3VsdFsxXS5yZXBsYWNlKC9fL2csICcuJyksXG4gICAgfTtcbiAgfSBlbHNlIGlmIChyZXN1bHQgPSBpUGhvbmVSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ2lQaG9uZSBPUycsXG4gICAgICB2ZXJzaW9uOiByZXN1bHRbMV0ucmVwbGFjZSgvXy9nLCAnLicpLFxuICAgIH07XG4gIH0gZWxzZSBpZiAocmVzdWx0ID0gbGludXhSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ0xpbnV4JyxcbiAgICAgIHZlcnNpb246ICdVbmtub3duJyxcbiAgICB9O1xuICB9IGVsc2UgaWYgKHJlc3VsdCA9IGFuZHJvaWRSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ0FuZHJvaWQnLFxuICAgICAgdmVyc2lvbjogcmVzdWx0WzFdIHx8ICdVbmtub3duJyxcbiAgICB9O1xuICB9IGVsc2UgaWYgKHJlc3VsdCA9IGNocm9taXVtT3NSZWdleC5leGVjKHVzZXJBZ2VudCkpIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ0Nocm9tZSBPUycsXG4gICAgICB2ZXJzaW9uOiAnVW5rbm93bicsXG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBpbmZvLm9zID0ge1xuICAgICAgbmFtZTogJ1Vua25vd24nLFxuICAgICAgdmVyc2lvbjogJ1Vua25vd24nLFxuICAgIH07XG4gIH1cbiAgaW5mby5jYXBhYmlsaXRpZXMgPSB7XG4gICAgY29udGludWFsSWNlR2F0aGVyaW5nOiBmYWxzZSxcbiAgICB1bmlmaWVkUGxhbjogdHJ1ZSxcbiAgICBzdHJlYW1SZW1vdmFibGU6IGluZm8ucnVudGltZS5uYW1lICE9PSAnRmlyZWZveCcsXG4gIH07XG4gIHJldHVybiBpbmZvO1xufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4vKiBlc2xpbnQtZGlzYWJsZSByZXF1aXJlLWpzZG9jICovXG4vKiBnbG9iYWwgUHJvbWlzZSAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbmltcG9ydCBMb2dnZXIgZnJvbSAnLi4vYmFzZS9sb2dnZXIuanMnO1xuaW1wb3J0IHtcbiAgRXZlbnREaXNwYXRjaGVyLFxuICBNZXNzYWdlRXZlbnQsXG4gIE93dEV2ZW50LFxuICBFcnJvckV2ZW50LFxuICBNdXRlRXZlbnRcbn0gZnJvbSAnLi4vYmFzZS9ldmVudC5qcyc7XG5pbXBvcnQgeyBUcmFja0tpbmQgfSBmcm9tICcuLi9iYXNlL21lZGlhZm9ybWF0LmpzJ1xuaW1wb3J0IHsgUHVibGljYXRpb24gfSBmcm9tICcuLi9iYXNlL3B1YmxpY2F0aW9uLmpzJztcbmltcG9ydCB7IFN1YnNjcmlwdGlvbiB9IGZyb20gJy4vc3Vic2NyaXB0aW9uLmpzJ1xuaW1wb3J0IHsgQ29uZmVyZW5jZUVycm9yIH0gZnJvbSAnLi9lcnJvci5qcydcbmltcG9ydCAqIGFzIFV0aWxzIGZyb20gJy4uL2Jhc2UvdXRpbHMuanMnO1xuaW1wb3J0ICogYXMgU2RwVXRpbHMgZnJvbSAnLi4vYmFzZS9zZHB1dGlscy5qcyc7XG5cbi8qKlxuICogQGNsYXNzIENvbmZlcmVuY2VQZWVyQ29ubmVjdGlvbkNoYW5uZWxcbiAqIEBjbGFzc0Rlc2MgQSBjaGFubmVsIGZvciBhIGNvbm5lY3Rpb24gYmV0d2VlbiBjbGllbnQgYW5kIGNvbmZlcmVuY2Ugc2VydmVyLiBDdXJyZW50bHksIG9ubHkgb25lIHN0cmVhbSBjb3VsZCBiZSB0cmFubWl0dGVkIGluIGEgY2hhbm5lbC5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25mZXJlbmNlUGVlckNvbm5lY3Rpb25DaGFubmVsIGV4dGVuZHMgRXZlbnREaXNwYXRjaGVyIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoY29uZmlnLCBzaWduYWxpbmcpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuX2NvbmZpZyA9IGNvbmZpZztcbiAgICB0aGlzLl9vcHRpb25zID0gbnVsbDtcbiAgICB0aGlzLl92aWRlb0NvZGVjcyA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLl9zaWduYWxpbmcgPSBzaWduYWxpbmc7XG4gICAgdGhpcy5fcGMgPSBudWxsO1xuICAgIHRoaXMuX2ludGVybmFsSWQgPSBudWxsOyAvLyBJdCdzIHB1YmxpY2F0aW9uIElEIG9yIHN1YnNjcmlwdGlvbiBJRC5cbiAgICB0aGlzLl9wZW5kaW5nQ2FuZGlkYXRlcyA9IFtdO1xuICAgIHRoaXMuX3N1YnNjcmliZVByb21pc2UgPSBudWxsO1xuICAgIHRoaXMuX3B1Ymxpc2hQcm9taXNlID0gbnVsbDtcbiAgICB0aGlzLl9zdWJzY3JpYmVkU3RyZWFtID0gbnVsbDtcbiAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW0gPSBudWxsO1xuICAgIHRoaXMuX3B1YmxpY2F0aW9uID0gbnVsbDtcbiAgICB0aGlzLl9zdWJzY3JpcHRpb24gPSBudWxsO1xuICAgIC8vIFRpbWVyIGZvciBQZWVyQ29ubmVjdGlvbiBkaXNjb25uZWN0ZWQuIFdpbGwgc3RvcCBjb25uZWN0aW9uIGFmdGVyIHRpbWVyLlxuICAgIHRoaXMuX2Rpc2Nvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgdGhpcy5fZW5kZWQgPSBmYWxzZTtcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIG9uTWVzc2FnZVxuICAgKiBAZGVzYyBSZWNlaXZlZCBhIG1lc3NhZ2UgZnJvbSBjb25mZXJlbmNlIHBvcnRhbC4gRGVmaW5lZCBpbiBjbGllbnQtc2VydmVyIHByb3RvY29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbm90aWZpY2F0aW9uIE5vdGlmaWNhdGlvbiB0eXBlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gbWVzc2FnZSBNZXNzYWdlIHJlY2VpdmVkLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgb25NZXNzYWdlKG5vdGlmaWNhdGlvbiwgbWVzc2FnZSkge1xuICAgIHN3aXRjaCAobm90aWZpY2F0aW9uKSB7XG4gICAgICBjYXNlICdwcm9ncmVzcyc6XG4gICAgICAgIGlmIChtZXNzYWdlLnN0YXR1cyA9PT0gJ3NvYWMnKSB7XG4gICAgICAgICAgdGhpcy5fc2RwSGFuZGxlcihtZXNzYWdlLmRhdGEpO1xuICAgICAgICB9IGVsc2UgaWYgKG1lc3NhZ2Uuc3RhdHVzID09PSAncmVhZHknKSB7XG4gICAgICAgICAgdGhpcy5fcmVhZHlIYW5kbGVyKCk7XG4gICAgICAgIH0gZWxzZSBpZiAobWVzc2FnZS5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICB0aGlzLl9lcnJvckhhbmRsZXIobWVzc2FnZS5kYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3N0cmVhbSc6XG4gICAgICAgIHRoaXMuX29uU3RyZWFtRXZlbnQobWVzc2FnZSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgTG9nZ2VyLndhcm5pbmcoJ1Vua25vd24gbm90aWZpY2F0aW9uIGZyb20gTUNVLicpO1xuICAgIH1cbiAgfVxuXG4gIHB1Ymxpc2goc3RyZWFtLCBvcHRpb25zLCB2aWRlb0NvZGVjcykge1xuICAgIGlmIChvcHRpb25zID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG9wdGlvbnMgPSB7YXVkaW86ICEhc3RyZWFtLm1lZGlhU3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkubGVuZ3RoLCB2aWRlbzogISFzdHJlYW1cbiAgICAgICAgICAubWVkaWFTdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5sZW5ndGh9O1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignT3B0aW9ucyBzaG91bGQgYmUgYW4gb2JqZWN0LicpKTtcbiAgICB9XG4gICAgaWYgKCh0aGlzLl9pc1J0cEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLmF1ZGlvKSAmJlxuICAgICAgICAgdGhpcy5faXNPd3RFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy52aWRlbykpIHx8XG4gICAgICAgICh0aGlzLl9pc093dEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLmF1ZGlvKSAmJlxuICAgICAgICAgdGhpcy5faXNSdHBFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy52aWRlbykpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcihcbiAgICAgICAgICAnTWl4aW5nIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycyBhbmQgQXVkaW9FbmNvZGluZ1BhcmFtZXRlcnMvVmlkZW9FbmNvZGluZ1BhcmFtZXRlcnMgaXMgbm90IGFsbG93ZWQuJykpXG4gICAgfVxuICAgIGlmIChvcHRpb25zLmF1ZGlvID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG9wdGlvbnMuYXVkaW8gPSAhIXN0cmVhbS5tZWRpYVN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmxlbmd0aDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMudmlkZW8gPT09IHVuZGVmaW5lZCkge1xuICAgICAgb3B0aW9ucy52aWRlbyA9ICEhc3RyZWFtLm1lZGlhU3RyZWFtLmdldFZpZGVvVHJhY2tzKCkubGVuZ3RoO1xuICAgIH1cbiAgICBpZiAoKCEhb3B0aW9ucy5hdWRpbyAmJiAhc3RyZWFtLm1lZGlhU3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkubGVuZ3RoKSB8fFxuICAgICAgICAoISFvcHRpb25zLnZpZGVvICYmICFzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5sZW5ndGgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcihcbiAgICAgICAgICAnb3B0aW9ucy5hdWRpby92aWRlbyBpcyBpbmNvbnNpc3RlbnQgd2l0aCB0cmFja3MgcHJlc2VudGVkIGluIHRoZSAnICtcbiAgICAgICAgICAnTWVkaWFTdHJlYW0uJ1xuICAgICAgKSk7XG4gICAgfVxuICAgIGlmICgob3B0aW9ucy5hdWRpbyA9PT0gZmFsc2UgfHwgb3B0aW9ucy5hdWRpbyA9PT0gbnVsbCkgJiZcbiAgICAgIChvcHRpb25zLnZpZGVvID09PSBmYWxzZSB8fCBvcHRpb25zLnZpZGVvID09PSBudWxsKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBDb25mZXJlbmNlRXJyb3IoXG4gICAgICAgICAgJ0Nhbm5vdCBwdWJsaXNoIGEgc3RyZWFtIHdpdGhvdXQgYXVkaW8gYW5kIHZpZGVvLicpKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLmF1ZGlvID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KG9wdGlvbnMuYXVkaW8pKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgVHlwZUVycm9yKFxuICAgICAgICAgICAgJ29wdGlvbnMuYXVkaW8gc2hvdWxkIGJlIGEgYm9vbGVhbiBvciBhbiBhcnJheS4nKSk7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHBhcmFtZXRlcnMgb2Ygb3B0aW9ucy5hdWRpbykge1xuICAgICAgICBpZiAoIXBhcmFtZXRlcnMuY29kZWMgfHwgdHlwZW9mIHBhcmFtZXRlcnMuY29kZWMubmFtZSAhPT0gJ3N0cmluZycgfHwgKFxuICAgICAgICAgIHBhcmFtZXRlcnMubWF4Qml0cmF0ZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBwYXJhbWV0ZXJzLm1heEJpdHJhdGVcbiAgICAgICAgICAhPT0gJ251bWJlcicpKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgICAgICdvcHRpb25zLmF1ZGlvIGhhcyBpbmNvcnJlY3QgcGFyYW1ldGVycy4nKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLnZpZGVvID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zLnZpZGVvKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICdvcHRpb25zLnZpZGVvIHNob3VsZCBiZSBhIGJvb2xlYW4gb3IgYW4gYXJyYXkuJykpO1xuICAgIH1cbiAgICBpZiAodGhpcy5faXNPd3RFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy52aWRlbykpIHtcbiAgICAgIGZvciAoY29uc3QgcGFyYW1ldGVycyBvZiBvcHRpb25zLnZpZGVvKSB7XG4gICAgICAgIGlmICghcGFyYW1ldGVycy5jb2RlYyB8fCB0eXBlb2YgcGFyYW1ldGVycy5jb2RlYy5uYW1lICE9PSAnc3RyaW5nJyB8fFxuICAgICAgICAgIChcbiAgICAgICAgICAgIHBhcmFtZXRlcnMubWF4Qml0cmF0ZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBwYXJhbWV0ZXJzXG4gICAgICAgICAgICAubWF4Qml0cmF0ZSAhPT1cbiAgICAgICAgICAgICdudW1iZXInKSB8fCAocGFyYW1ldGVycy5jb2RlYy5wcm9maWxlICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgICAgIHR5cGVvZiBwYXJhbWV0ZXJzLmNvZGVjLnByb2ZpbGUgIT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgVHlwZUVycm9yKFxuICAgICAgICAgICAgJ29wdGlvbnMudmlkZW8gaGFzIGluY29ycmVjdCBwYXJhbWV0ZXJzLicpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICBjb25zdCBtZWRpYU9wdGlvbnMgPSB7fTtcbiAgICB0aGlzLl9jcmVhdGVQZWVyQ29ubmVjdGlvbigpO1xuICAgIGlmIChzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5sZW5ndGggPiAwICYmIG9wdGlvbnMuYXVkaW8gIT09XG4gICAgICBmYWxzZSAmJiBvcHRpb25zLmF1ZGlvICE9PSBudWxsKSB7XG4gICAgICBpZiAoc3RyZWFtLm1lZGlhU3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkubGVuZ3RoID4gMSkge1xuICAgICAgICBMb2dnZXIud2FybmluZyhcbiAgICAgICAgICAgICdQdWJsaXNoaW5nIGEgc3RyZWFtIHdpdGggbXVsdGlwbGUgYXVkaW8gdHJhY2tzIGlzIG5vdCBmdWxseSdcbiAgICAgICAgICAgICsgJyBzdXBwb3J0ZWQuJ1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zLmF1ZGlvICE9PSAnYm9vbGVhbicgJiYgdHlwZW9mIG9wdGlvbnMuYXVkaW8gIT09XG4gICAgICAgICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgQ29uZmVyZW5jZUVycm9yKFxuICAgICAgICAgICAgJ1R5cGUgb2YgYXVkaW8gb3B0aW9ucyBzaG91bGQgYmUgYm9vbGVhbiBvciBhbiBvYmplY3QuJ1xuICAgICAgICApKTtcbiAgICAgIH1cbiAgICAgIG1lZGlhT3B0aW9ucy5hdWRpbyA9IHt9O1xuICAgICAgbWVkaWFPcHRpb25zLmF1ZGlvLnNvdXJjZSA9IHN0cmVhbS5zb3VyY2UuYXVkaW87XG4gICAgfSBlbHNlIHtcbiAgICAgIG1lZGlhT3B0aW9ucy5hdWRpbyA9IGZhbHNlO1xuICAgIH1cbiAgICBpZiAoc3RyZWFtLm1lZGlhU3RyZWFtLmdldFZpZGVvVHJhY2tzKCkubGVuZ3RoID4gMCAmJiBvcHRpb25zLnZpZGVvICE9PVxuICAgICAgZmFsc2UgJiYgb3B0aW9ucy52aWRlbyAhPT0gbnVsbCkge1xuICAgICAgaWYgKHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgTG9nZ2VyLndhcm5pbmcoXG4gICAgICAgICAgICAnUHVibGlzaGluZyBhIHN0cmVhbSB3aXRoIG11bHRpcGxlIHZpZGVvIHRyYWNrcyBpcyBub3QgZnVsbHkgJ1xuICAgICAgICAgICAgKyAnc3VwcG9ydGVkLidcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIG1lZGlhT3B0aW9ucy52aWRlbyA9IHt9O1xuICAgICAgbWVkaWFPcHRpb25zLnZpZGVvLnNvdXJjZSA9IHN0cmVhbS5zb3VyY2UudmlkZW87XG4gICAgICBjb25zdCB0cmFja1NldHRpbmdzID0gc3RyZWFtLm1lZGlhU3RyZWFtLmdldFZpZGVvVHJhY2tzKClbMF1cbiAgICAgICAgICAuZ2V0U2V0dGluZ3MoKTtcbiAgICAgIG1lZGlhT3B0aW9ucy52aWRlby5wYXJhbWV0ZXJzID0ge1xuICAgICAgICByZXNvbHV0aW9uOiB7XG4gICAgICAgICAgd2lkdGg6IHRyYWNrU2V0dGluZ3Mud2lkdGgsXG4gICAgICAgICAgaGVpZ2h0OiB0cmFja1NldHRpbmdzLmhlaWdodCxcbiAgICAgICAgfSxcbiAgICAgICAgZnJhbWVyYXRlOiB0cmFja1NldHRpbmdzLmZyYW1lUmF0ZSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIG1lZGlhT3B0aW9ucy52aWRlbyA9IGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5fc2lnbmFsaW5nLnNlbmRTaWduYWxpbmdNZXNzYWdlKCdwdWJsaXNoJywge1xuICAgICAgbWVkaWE6IG1lZGlhT3B0aW9ucyxcbiAgICAgIGF0dHJpYnV0ZXM6IHN0cmVhbS5hdHRyaWJ1dGVzLFxuICAgIH0pLnRoZW4oKGRhdGEpID0+IHtcbiAgICAgIGNvbnN0IG1lc3NhZ2VFdmVudCA9IG5ldyBNZXNzYWdlRXZlbnQoJ2lkJywge1xuICAgICAgICBtZXNzYWdlOiBkYXRhLmlkLFxuICAgICAgICBvcmlnaW46IHRoaXMuX3JlbW90ZUlkLFxuICAgICAgfSk7XG4gICAgICB0aGlzLmRpc3BhdGNoRXZlbnQobWVzc2FnZUV2ZW50KTtcbiAgICAgIHRoaXMuX2ludGVybmFsSWQgPSBkYXRhLmlkO1xuICAgICAgY29uc3Qgb2ZmZXJPcHRpb25zID0ge307XG4gICAgICBpZiAodHlwZW9mIHRoaXMuX3BjLmFkZFRyYW5zY2VpdmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGxldCBzZXRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIC8vIHxkaXJlY3Rpb258IHNlZW1zIG5vdCB3b3JraW5nIG9uIFNhZmFyaS5cbiAgICAgICAgaWYgKG1lZGlhT3B0aW9ucy5hdWRpbyAmJiBzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5sZW5ndGggPlxuICAgICAgICAgIDApIHtcbiAgICAgICAgICBjb25zdCB0cmFuc2NlaXZlckluaXQgPSB7XG4gICAgICAgICAgICBkaXJlY3Rpb246ICdzZW5kb25seSdcbiAgICAgICAgICB9O1xuICAgICAgICAgIGlmICh0aGlzLl9pc1J0cEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLmF1ZGlvKSkge1xuICAgICAgICAgICAgdHJhbnNjZWl2ZXJJbml0LnNlbmRFbmNvZGluZ3MgPSBvcHRpb25zLmF1ZGlvO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCB0cmFuc2NlaXZlciA9IHRoaXMuX3BjLmFkZFRyYW5zY2VpdmVyKHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRBdWRpb1RyYWNrcygpWzBdLFxuICAgICAgICAgICAgdHJhbnNjZWl2ZXJJbml0KTtcblxuICAgICAgICAgIGlmIChVdGlscy5pc0ZpcmVmb3goKSkge1xuICAgICAgICAgICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGVuY29kaW5ncyBzZXR0aW5nIGluIGFkZFRyYW5zY2VpdmVyLlxuICAgICAgICAgICAgY29uc3QgcGFyYW1ldGVycyA9IHRyYW5zY2VpdmVyLnNlbmRlci5nZXRQYXJhbWV0ZXJzKCk7XG4gICAgICAgICAgICBwYXJhbWV0ZXJzLmVuY29kaW5ncyA9IHRyYW5zY2VpdmVySW5pdC5zZW5kRW5jb2RpbmdzO1xuICAgICAgICAgICAgc2V0UHJvbWlzZSA9IHRyYW5zY2VpdmVyLnNlbmRlci5zZXRQYXJhbWV0ZXJzKHBhcmFtZXRlcnMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWVkaWFPcHRpb25zLnZpZGVvICYmIHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmxlbmd0aCA+XG4gICAgICAgICAgMCkge1xuICAgICAgICAgIGNvbnN0IHRyYW5zY2VpdmVySW5pdCA9IHtcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3NlbmRvbmx5J1xuICAgICAgICAgIH07XG4gICAgICAgICAgaWYgKHRoaXMuX2lzUnRwRW5jb2RpbmdQYXJhbWV0ZXJzKG9wdGlvbnMudmlkZW8pKSB7XG4gICAgICAgICAgICB0cmFuc2NlaXZlckluaXQuc2VuZEVuY29kaW5ncyA9IG9wdGlvbnMudmlkZW87XG4gICAgICAgICAgICB0aGlzLl92aWRlb0NvZGVjcyA9IHZpZGVvQ29kZWNzO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCB0cmFuc2NlaXZlciA9IHRoaXMuX3BjLmFkZFRyYW5zY2VpdmVyKHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRWaWRlb1RyYWNrcygpWzBdLFxuICAgICAgICAgICAgdHJhbnNjZWl2ZXJJbml0KTtcblxuICAgICAgICAgIGlmIChVdGlscy5pc0ZpcmVmb3goKSkge1xuICAgICAgICAgICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGVuY29kaW5ncyBzZXR0aW5nIGluIGFkZFRyYW5zY2VpdmVyLlxuICAgICAgICAgICAgY29uc3QgcGFyYW1ldGVycyA9IHRyYW5zY2VpdmVyLnNlbmRlci5nZXRQYXJhbWV0ZXJzKCk7XG4gICAgICAgICAgICBwYXJhbWV0ZXJzLmVuY29kaW5ncyA9IHRyYW5zY2VpdmVySW5pdC5zZW5kRW5jb2RpbmdzO1xuICAgICAgICAgICAgc2V0UHJvbWlzZSA9IHNldFByb21pc2UudGhlbihcbiAgICAgICAgICAgICAgKCkgPT4gdHJhbnNjZWl2ZXIuc2VuZGVyLnNldFBhcmFtZXRlcnMocGFyYW1ldGVycykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2V0UHJvbWlzZS50aGVuKCgpID0+IG9mZmVyT3B0aW9ucyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAobWVkaWFPcHRpb25zLmF1ZGlvICYmIHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IHRyYWNrIG9mIHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRBdWRpb1RyYWNrcygpKVxuICAgICAgICAgICAgdGhpcy5fcGMuYWRkVHJhY2sodHJhY2ssIHN0cmVhbS5tZWRpYVN0cmVhbSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lZGlhT3B0aW9ucy52aWRlbyAmJiBzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZm9yIChjb25zdCB0cmFjayBvZiBzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0VmlkZW9UcmFja3MoKSlcbiAgICAgICAgICAgIHRoaXMuX3BjLmFkZFRyYWNrKHRyYWNrLCBzdHJlYW0ubWVkaWFTdHJlYW0pO1xuICAgICAgICB9XG4gICAgICAgIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID0gZmFsc2U7XG4gICAgICAgIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID0gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gb2ZmZXJPcHRpb25zO1xuICAgIH0pLnRoZW4oKG9mZmVyT3B0aW9ucykgPT4ge1xuICAgICAgbGV0IGxvY2FsRGVzYztcbiAgICAgIHRoaXMuX3BjLmNyZWF0ZU9mZmVyKG9mZmVyT3B0aW9ucykudGhlbigoZGVzYykgPT4ge1xuICAgICAgICBpZiAob3B0aW9ucykge1xuICAgICAgICAgIGRlc2Muc2RwID0gdGhpcy5fc2V0UnRwUmVjZWl2ZXJPcHRpb25zKGRlc2Muc2RwLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVzYztcbiAgICAgIH0pLnRoZW4oKGRlc2MpID0+IHtcbiAgICAgICAgbG9jYWxEZXNjID0gZGVzYztcbiAgICAgICAgcmV0dXJuIHRoaXMuX3BjLnNldExvY2FsRGVzY3JpcHRpb24oZGVzYyk7XG4gICAgICB9KS50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5fc2lnbmFsaW5nLnNlbmRTaWduYWxpbmdNZXNzYWdlKCdzb2FjJywge1xuICAgICAgICAgIGlkOiB0aGlzXG4gICAgICAgICAgICAgIC5faW50ZXJuYWxJZCxcbiAgICAgICAgICBzaWduYWxpbmc6IGxvY2FsRGVzYyxcbiAgICAgICAgfSk7XG4gICAgICB9KS5jYXRjaCgoZSkgPT4ge1xuICAgICAgICBMb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgb2ZmZXIgb3Igc2V0IFNEUC4gTWVzc2FnZTogJ1xuICAgICAgICAgICAgKyBlLm1lc3NhZ2UpO1xuICAgICAgICB0aGlzLl91bnB1Ymxpc2goKTtcbiAgICAgICAgdGhpcy5fcmVqZWN0UHJvbWlzZShlKTtcbiAgICAgICAgdGhpcy5fZmlyZUVuZGVkRXZlbnRPblB1YmxpY2F0aW9uT3JTdWJzY3JpcHRpb24oKTtcbiAgICAgIH0pO1xuICAgIH0pLmNhdGNoKChlKSA9PiB7XG4gICAgICB0aGlzLl91bnB1Ymxpc2goKTtcbiAgICAgIHRoaXMuX3JlamVjdFByb21pc2UoZSk7XG4gICAgICB0aGlzLl9maXJlRW5kZWRFdmVudE9uUHVibGljYXRpb25PclN1YnNjcmlwdGlvbigpO1xuICAgIH0pO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9wdWJsaXNoUHJvbWlzZSA9IHtyZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdH07XG4gICAgfSk7XG4gIH1cblxuICBzdWJzY3JpYmUoc3RyZWFtLCBvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgb3B0aW9ucyA9IHtcbiAgICAgICAgYXVkaW86ICEhc3RyZWFtLnNldHRpbmdzLmF1ZGlvLFxuICAgICAgICB2aWRlbzogISFzdHJlYW0uc2V0dGluZ3MudmlkZW8sXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignT3B0aW9ucyBzaG91bGQgYmUgYW4gb2JqZWN0LicpKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuYXVkaW8gPT09IHVuZGVmaW5lZCkge1xuICAgICAgb3B0aW9ucy5hdWRpbyA9ICEhc3RyZWFtLnNldHRpbmdzLmF1ZGlvO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy52aWRlbyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBvcHRpb25zLnZpZGVvID0gISFzdHJlYW0uc2V0dGluZ3MudmlkZW87XG4gICAgfVxuICAgIGlmICgob3B0aW9ucy5hdWRpbyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvcHRpb25zLmF1ZGlvICE9PSAnb2JqZWN0JyAmJlxuICAgICAgICB0eXBlb2Ygb3B0aW9ucy5hdWRpbyAhPT0gJ2Jvb2xlYW4nICYmIG9wdGlvbnMuYXVkaW8gIT09IG51bGwpIHx8IChcbiAgICAgIG9wdGlvbnMudmlkZW8gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb3B0aW9ucy52aWRlbyAhPT0gJ29iamVjdCcgJiZcbiAgICAgICAgdHlwZW9mIG9wdGlvbnMudmlkZW8gIT09ICdib29sZWFuJyAmJiBvcHRpb25zLnZpZGVvICE9PSBudWxsKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgb3B0aW9ucyB0eXBlLicpKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuYXVkaW8gJiYgIXN0cmVhbS5zZXR0aW5ncy5hdWRpbyB8fCAob3B0aW9ucy52aWRlbyAmJlxuICAgICAgICAhc3RyZWFtLnNldHRpbmdzLnZpZGVvKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBDb25mZXJlbmNlRXJyb3IoXG4gICAgICAgICAgJ29wdGlvbnMuYXVkaW8vdmlkZW8gY2Fubm90IGJlIHRydWUgb3IgYW4gb2JqZWN0IGlmIHRoZXJlIGlzIG5vICdcbiAgICAgICAgICArICdhdWRpby92aWRlbyB0cmFjayBpbiByZW1vdGUgc3RyZWFtLidcbiAgICAgICkpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5hdWRpbyA9PT0gZmFsc2UgJiYgb3B0aW9ucy52aWRlbyA9PT0gZmFsc2UpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgQ29uZmVyZW5jZUVycm9yKFxuICAgICAgICAgICdDYW5ub3Qgc3Vic2NyaWJlIGEgc3RyZWFtIHdpdGhvdXQgYXVkaW8gYW5kIHZpZGVvLicpKTtcbiAgICB9XG4gICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgY29uc3QgbWVkaWFPcHRpb25zID0ge307XG4gICAgaWYgKG9wdGlvbnMuYXVkaW8pIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5hdWRpbyA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgICBBcnJheS5pc0FycmF5KG9wdGlvbnMuYXVkaW8uY29kZWNzKSkge1xuICAgICAgICBpZiAob3B0aW9ucy5hdWRpby5jb2RlY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgICAgICdBdWRpbyBjb2RlYyBjYW5ub3QgYmUgYW4gZW1wdHkgYXJyYXkuJykpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBtZWRpYU9wdGlvbnMuYXVkaW8gPSB7fTtcbiAgICAgIG1lZGlhT3B0aW9ucy5hdWRpby5mcm9tID0gc3RyZWFtLmlkO1xuICAgIH0gZWxzZSB7XG4gICAgICBtZWRpYU9wdGlvbnMuYXVkaW8gPSBmYWxzZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMudmlkZW8pIHtcbiAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy52aWRlbyA9PT0gJ29iamVjdCcgJiZcbiAgICAgICAgICBBcnJheS5pc0FycmF5KG9wdGlvbnMudmlkZW8uY29kZWNzKSkge1xuICAgICAgICBpZiAob3B0aW9ucy52aWRlby5jb2RlY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgICAgICdWaWRlbyBjb2RlYyBjYW5ub3QgYmUgYW4gZW1wdHkgYXJyYXkuJykpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBtZWRpYU9wdGlvbnMudmlkZW8gPSB7fTtcbiAgICAgIG1lZGlhT3B0aW9ucy52aWRlby5mcm9tID0gc3RyZWFtLmlkO1xuICAgICAgaWYgKG9wdGlvbnMudmlkZW8ucmVzb2x1dGlvbiB8fCBvcHRpb25zLnZpZGVvLmZyYW1lUmF0ZSB8fCAob3B0aW9ucy52aWRlb1xuICAgICAgICAgIC5iaXRyYXRlTXVsdGlwbGllciAmJiBvcHRpb25zLnZpZGVvLmJpdHJhdGVNdWx0aXBsaWVyICE9PSAxKSB8fFxuICAgICAgICBvcHRpb25zLnZpZGVvLmtleUZyYW1lSW50ZXJ2YWwpIHtcbiAgICAgICAgbWVkaWFPcHRpb25zLnZpZGVvLnBhcmFtZXRlcnMgPSB7XG4gICAgICAgICAgcmVzb2x1dGlvbjogb3B0aW9ucy52aWRlby5yZXNvbHV0aW9uLFxuICAgICAgICAgIGZyYW1lcmF0ZTogb3B0aW9ucy52aWRlby5mcmFtZVJhdGUsXG4gICAgICAgICAgYml0cmF0ZTogb3B0aW9ucy52aWRlby5iaXRyYXRlTXVsdGlwbGllciA/ICd4J1xuICAgICAgICAgICAgICArIG9wdGlvbnMudmlkZW8uYml0cmF0ZU11bHRpcGxpZXIudG9TdHJpbmcoKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBrZXlGcmFtZUludGVydmFsOiBvcHRpb25zLnZpZGVvLmtleUZyYW1lSW50ZXJ2YWxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRpb25zLnZpZGVvLnJpZCkge1xuICAgICAgICBtZWRpYU9wdGlvbnMudmlkZW8uc2ltdWxjYXN0UmlkID0gb3B0aW9ucy52aWRlby5yaWQ7XG4gICAgICAgIC8vIElnbm9yZSBvdGhlciBzZXR0aW5ncyB3aGVuIFJJRCBzZXQuXG4gICAgICAgIGRlbGV0ZSBtZWRpYU9wdGlvbnMudmlkZW8ucGFyYW1ldGVycztcbiAgICAgICAgb3B0aW9ucy52aWRlbyA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG1lZGlhT3B0aW9ucy52aWRlbyA9IGZhbHNlO1xuICAgIH1cblxuICAgIHRoaXMuX3N1YnNjcmliZWRTdHJlYW0gPSBzdHJlYW07XG4gICAgdGhpcy5fc2lnbmFsaW5nLnNlbmRTaWduYWxpbmdNZXNzYWdlKCdzdWJzY3JpYmUnLCB7XG4gICAgICBtZWRpYTogbWVkaWFPcHRpb25zLFxuICAgIH0pLnRoZW4oKGRhdGEpID0+IHtcbiAgICAgIGNvbnN0IG1lc3NhZ2VFdmVudCA9IG5ldyBNZXNzYWdlRXZlbnQoJ2lkJywge1xuICAgICAgICBtZXNzYWdlOiBkYXRhLmlkLFxuICAgICAgICBvcmlnaW46IHRoaXMuX3JlbW90ZUlkLFxuICAgICAgfSk7XG4gICAgICB0aGlzLmRpc3BhdGNoRXZlbnQobWVzc2FnZUV2ZW50KTtcbiAgICAgIHRoaXMuX2ludGVybmFsSWQgPSBkYXRhLmlkO1xuICAgICAgdGhpcy5fY3JlYXRlUGVlckNvbm5lY3Rpb24oKTtcbiAgICAgIGNvbnN0IG9mZmVyT3B0aW9ucyA9IHt9O1xuICAgICAgaWYgKHR5cGVvZiB0aGlzLl9wYy5hZGRUcmFuc2NlaXZlciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyB8ZGlyZWN0aW9ufCBzZWVtcyBub3Qgd29ya2luZyBvbiBTYWZhcmkuXG4gICAgICAgIGlmIChtZWRpYU9wdGlvbnMuYXVkaW8pIHtcbiAgICAgICAgICB0aGlzLl9wYy5hZGRUcmFuc2NlaXZlcignYXVkaW8nLCB7ZGlyZWN0aW9uOiAncmVjdm9ubHknfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lZGlhT3B0aW9ucy52aWRlbykge1xuICAgICAgICAgIHRoaXMuX3BjLmFkZFRyYW5zY2VpdmVyKCd2aWRlbycsIHtkaXJlY3Rpb246ICdyZWN2b25seSd9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPSAhIW9wdGlvbnMuYXVkaW87XG4gICAgICAgIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID0gISFvcHRpb25zLnZpZGVvO1xuICAgICAgfVxuXG4gICAgICB0aGlzLl9wYy5jcmVhdGVPZmZlcihvZmZlck9wdGlvbnMpLnRoZW4oKGRlc2MpID0+IHtcbiAgICAgICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgICAgICBkZXNjLnNkcCA9IHRoaXMuX3NldFJ0cFJlY2VpdmVyT3B0aW9ucyhkZXNjLnNkcCwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fcGMuc2V0TG9jYWxEZXNjcmlwdGlvbihkZXNjKS50aGVuKCgpID0+IHtcbiAgICAgICAgICB0aGlzLl9zaWduYWxpbmcuc2VuZFNpZ25hbGluZ01lc3NhZ2UoJ3NvYWMnLCB7XG4gICAgICAgICAgICBpZDogdGhpc1xuICAgICAgICAgICAgICAgIC5faW50ZXJuYWxJZCxcbiAgICAgICAgICAgIHNpZ25hbGluZzogZGVzYyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3JNZXNzYWdlKSB7XG4gICAgICAgICAgTG9nZ2VyLmVycm9yKCdTZXQgbG9jYWwgZGVzY3JpcHRpb24gZmFpbGVkLiBNZXNzYWdlOiAnICtcbiAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGVycm9yTWVzc2FnZSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0sIGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgIExvZ2dlci5lcnJvcignQ3JlYXRlIG9mZmVyIGZhaWxlZC4gRXJyb3IgaW5mbzogJyArIEpTT04uc3RyaW5naWZ5KFxuICAgICAgICAgICAgZXJyb3IpKTtcbiAgICAgIH0pLmNhdGNoKChlKT0+e1xuICAgICAgICBMb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgb2ZmZXIgb3Igc2V0IFNEUC4gTWVzc2FnZTogJ1xuICAgICAgICAgICAgKyBlLm1lc3NhZ2UpO1xuICAgICAgICB0aGlzLl91bnN1YnNjcmliZSgpO1xuICAgICAgICB0aGlzLl9yZWplY3RQcm9taXNlKGUpO1xuICAgICAgICB0aGlzLl9maXJlRW5kZWRFdmVudE9uUHVibGljYXRpb25PclN1YnNjcmlwdGlvbigpO1xuICAgICAgfSk7XG4gICAgfSkuY2F0Y2goKGUpID0+IHtcbiAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlKCk7XG4gICAgICB0aGlzLl9yZWplY3RQcm9taXNlKGUpO1xuICAgICAgdGhpcy5fZmlyZUVuZGVkRXZlbnRPblB1YmxpY2F0aW9uT3JTdWJzY3JpcHRpb24oKTtcbiAgICB9KTtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSA9IHtyZXNvbHZlOiByZXNvbHZlLCByZWplY3Q6IHJlamVjdH07XG4gICAgfSk7XG4gIH1cblxuICBfdW5wdWJsaXNoKCkge1xuICAgIGlmICghdGhpcy5fc3RvcHBlZCkge1xuICAgICAgdGhpcy5fc3RvcHBlZCA9IHRydWU7XG4gICAgICB0aGlzLl9zaWduYWxpbmcuc2VuZFNpZ25hbGluZ01lc3NhZ2UoJ3VucHVibGlzaCcsIHtpZDogdGhpcy5faW50ZXJuYWxJZH0pXG4gICAgICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgICAgICBMb2dnZXIud2FybmluZygnTUNVIHJldHVybnMgbmVnYXRpdmUgYWNrIGZvciB1bnB1Ymxpc2hpbmcsICcgKyBlKTtcbiAgICAgICAgICB9KTtcbiAgICAgIGlmICh0aGlzLl9wYyAmJiB0aGlzLl9wYy5zaWduYWxpbmdTdGF0ZSAhPT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgdGhpcy5fcGMuY2xvc2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBfdW5zdWJzY3JpYmUoKSB7XG4gICAgaWYgKCF0aGlzLl9zdG9wcGVkKSB7XG4gICAgICB0aGlzLl9zdG9wcGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuX3NpZ25hbGluZy5zZW5kU2lnbmFsaW5nTWVzc2FnZSgndW5zdWJzY3JpYmUnLCB7XG4gICAgICAgIGlkOiB0aGlzLl9pbnRlcm5hbElkLFxuICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgICAgIExvZ2dlci53YXJuaW5nKCdNQ1UgcmV0dXJucyBuZWdhdGl2ZSBhY2sgZm9yIHVuc3Vic2NyaWJpbmcsICcgKyBlKTtcbiAgICAgICAgICB9KTtcbiAgICAgIGlmICh0aGlzLl9wYyAmJiB0aGlzLl9wYy5zaWduYWxpbmdTdGF0ZSAhPT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgdGhpcy5fcGMuY2xvc2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBfbXV0ZU9yVW5tdXRlKGlzTXV0ZSwgaXNQdWIsIHRyYWNrS2luZCkge1xuICAgIGNvbnN0IGV2ZW50TmFtZSA9IGlzUHViID8gJ3N0cmVhbS1jb250cm9sJyA6XG4gICAgICAnc3Vic2NyaXB0aW9uLWNvbnRyb2wnO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IGlzTXV0ZSA/ICdwYXVzZScgOiAncGxheSc7XG4gICAgcmV0dXJuIHRoaXMuX3NpZ25hbGluZy5zZW5kU2lnbmFsaW5nTWVzc2FnZShldmVudE5hbWUsIHtcbiAgICAgIGlkOiB0aGlzLl9pbnRlcm5hbElkLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb24sXG4gICAgICBkYXRhOiB0cmFja0tpbmQsXG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBpZiAoIWlzUHViKSB7XG4gICAgICAgIGNvbnN0IG11dGVFdmVudE5hbWUgPSBpc011dGUgPyAnbXV0ZScgOiAndW5tdXRlJztcbiAgICAgICAgdGhpcy5fc3Vic2NyaXB0aW9uLmRpc3BhdGNoRXZlbnQoXG4gICAgICAgICAgICBuZXcgTXV0ZUV2ZW50KG11dGVFdmVudE5hbWUsIHtraW5kOiB0cmFja0tpbmR9KSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBfYXBwbHlPcHRpb25zKG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMgIT09ICdvYmplY3QnIHx8IHR5cGVvZiBvcHRpb25zLnZpZGVvICE9PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBDb25mZXJlbmNlRXJyb3IoXG4gICAgICAgICAgJ09wdGlvbnMgc2hvdWxkIGJlIGFuIG9iamVjdC4nKSk7XG4gICAgfVxuICAgIGNvbnN0IHZpZGVvT3B0aW9ucyA9IHt9O1xuICAgIHZpZGVvT3B0aW9ucy5yZXNvbHV0aW9uID0gb3B0aW9ucy52aWRlby5yZXNvbHV0aW9uO1xuICAgIHZpZGVvT3B0aW9ucy5mcmFtZXJhdGUgPSBvcHRpb25zLnZpZGVvLmZyYW1lUmF0ZTtcbiAgICB2aWRlb09wdGlvbnMuYml0cmF0ZSA9IG9wdGlvbnMudmlkZW8uYml0cmF0ZU11bHRpcGxpZXIgPyAneCcgKyBvcHRpb25zLnZpZGVvXG4gICAgICAgIC5iaXRyYXRlTXVsdGlwbGllclxuICAgICAgICAudG9TdHJpbmcoKSA6IHVuZGVmaW5lZDtcbiAgICB2aWRlb09wdGlvbnMua2V5RnJhbWVJbnRlcnZhbCA9IG9wdGlvbnMudmlkZW8ua2V5RnJhbWVJbnRlcnZhbDtcbiAgICByZXR1cm4gdGhpcy5fc2lnbmFsaW5nLnNlbmRTaWduYWxpbmdNZXNzYWdlKCdzdWJzY3JpcHRpb24tY29udHJvbCcsIHtcbiAgICAgIGlkOiB0aGlzLl9pbnRlcm5hbElkLFxuICAgICAgb3BlcmF0aW9uOiAndXBkYXRlJyxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdmlkZW86IHtwYXJhbWV0ZXJzOiB2aWRlb09wdGlvbnN9LFxuICAgICAgfSxcbiAgICB9KS50aGVuKCk7XG4gIH1cblxuICBfb25SZW1vdGVTdHJlYW1BZGRlZChldmVudCkge1xuICAgIExvZ2dlci5kZWJ1ZygnUmVtb3RlIHN0cmVhbSBhZGRlZC4nKTtcbiAgICBpZiAodGhpcy5fc3Vic2NyaWJlZFN0cmVhbSkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlZFN0cmVhbS5tZWRpYVN0cmVhbSA9IGV2ZW50LnN0cmVhbXNbMF07XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoaXMgaXMgbm90IGV4cGVjdGVkIHBhdGguIEhvd2V2ZXIsIHRoaXMgaXMgZ29pbmcgdG8gaGFwcGVuIG9uIFNhZmFyaVxuICAgICAgLy8gYmVjYXVzZSBpdCBkb2VzIG5vdCBzdXBwb3J0IHNldHRpbmcgZGlyZWN0aW9uIG9mIHRyYW5zY2VpdmVyLlxuICAgICAgTG9nZ2VyLndhcm5pbmcoJ1JlY2VpdmVkIHJlbW90ZSBzdHJlYW0gd2l0aG91dCBzdWJzY3JpcHRpb24uJyk7XG4gICAgfVxuICB9XG5cbiAgX29uTG9jYWxJY2VDYW5kaWRhdGUoZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQuY2FuZGlkYXRlKSB7XG4gICAgICBpZiAodGhpcy5fcGMuc2lnbmFsaW5nU3RhdGUgIT09ICdzdGFibGUnKSB7XG4gICAgICAgIHRoaXMuX3BlbmRpbmdDYW5kaWRhdGVzLnB1c2goZXZlbnQuY2FuZGlkYXRlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX3NlbmRDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2VyLmRlYnVnKCdFbXB0eSBjYW5kaWRhdGUuJyk7XG4gICAgfVxuICB9XG5cbiAgX2ZpcmVFbmRlZEV2ZW50T25QdWJsaWNhdGlvbk9yU3Vic2NyaXB0aW9uKCkge1xuICAgIGlmICh0aGlzLl9lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9lbmRlZCA9IHRydWU7XG4gICAgY29uc3QgZXZlbnQgPSBuZXcgT3d0RXZlbnQoJ2VuZGVkJyk7XG4gICAgaWYgKHRoaXMuX3B1YmxpY2F0aW9uKSB7XG4gICAgICB0aGlzLl9wdWJsaWNhdGlvbi5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICAgIHRoaXMuX3B1YmxpY2F0aW9uLnN0b3AoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3N1YnNjcmlwdGlvbikge1xuICAgICAgdGhpcy5fc3Vic2NyaXB0aW9uLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgdGhpcy5fc3Vic2NyaXB0aW9uLnN0b3AoKTtcbiAgICB9XG4gIH1cblxuICBfcmVqZWN0UHJvbWlzZShlcnJvcikge1xuICAgIGlmICghZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IENvbmZlcmVuY2VFcnJvcignQ29ubmVjdGlvbiBmYWlsZWQgb3IgY2xvc2VkLicpO1xuICAgIH1cbiAgICAvLyBSZWplY3RpbmcgY29ycmVzcG9uZGluZyBwcm9taXNlIGlmIHB1Ymxpc2hpbmcgYW5kIHN1YnNjcmliaW5nIGlzIG9uZ29pbmcuXG4gICAgaWYgKHRoaXMuX3B1Ymxpc2hQcm9taXNlKSB7XG4gICAgICB0aGlzLl9wdWJsaXNoUHJvbWlzZS5yZWplY3QoZXJyb3IpO1xuICAgICAgdGhpcy5fcHVibGlzaFByb21pc2UgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9zdWJzY3JpYmVQcm9taXNlKSB7XG4gICAgICB0aGlzLl9zdWJzY3JpYmVQcm9taXNlLnJlamVjdChlcnJvcik7XG4gICAgICB0aGlzLl9zdWJzY3JpYmVQcm9taXNlID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIF9vbkljZUNvbm5lY3Rpb25TdGF0ZUNoYW5nZShldmVudCkge1xuICAgIGlmICghZXZlbnQgfHwgIWV2ZW50LmN1cnJlbnRUYXJnZXQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBMb2dnZXIuZGVidWcoJ0lDRSBjb25uZWN0aW9uIHN0YXRlIGNoYW5nZWQgdG8gJyArXG4gICAgICAgIGV2ZW50LmN1cnJlbnRUYXJnZXQuaWNlQ29ubmVjdGlvblN0YXRlKTtcbiAgICBpZiAoZXZlbnQuY3VycmVudFRhcmdldC5pY2VDb25uZWN0aW9uU3RhdGUgPT09ICdjbG9zZWQnIHx8XG4gICAgICAgIGV2ZW50LmN1cnJlbnRUYXJnZXQuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnZmFpbGVkJykge1xuICAgICAgaWYgKGV2ZW50LmN1cnJlbnRUYXJnZXQuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnZmFpbGVkJykge1xuICAgICAgICB0aGlzLl9oYW5kbGVFcnJvcignY29ubmVjdGlvbiBmYWlsZWQuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBGaXJlIGVuZGVkIGV2ZW50IGlmIHB1YmxpY2F0aW9uIG9yIHN1YnNjcmlwdGlvbiBleGlzdHMuXG4gICAgICAgIHRoaXMuX2ZpcmVFbmRlZEV2ZW50T25QdWJsaWNhdGlvbk9yU3Vic2NyaXB0aW9uKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgX29uQ29ubmVjdGlvblN0YXRlQ2hhbmdlKGV2ZW50KSB7XG4gICAgaWYgKHRoaXMuX3BjLmNvbm5lY3Rpb25TdGF0ZSA9PT0gJ2Nsb3NlZCcgfHxcbiAgICAgICAgdGhpcy5fcGMuY29ubmVjdGlvblN0YXRlID09PSAnZmFpbGVkJykge1xuICAgICAgaWYgKHRoaXMuX3BjLmNvbm5lY3Rpb25TdGF0ZSA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlRXJyb3IoJ2Nvbm5lY3Rpb24gZmFpbGVkLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmlyZSBlbmRlZCBldmVudCBpZiBwdWJsaWNhdGlvbiBvciBzdWJzY3JpcHRpb24gZXhpc3RzLlxuICAgICAgICB0aGlzLl9maXJlRW5kZWRFdmVudE9uUHVibGljYXRpb25PclN1YnNjcmlwdGlvbigpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIF9zZW5kQ2FuZGlkYXRlKGNhbmRpZGF0ZSkge1xuICAgIHRoaXMuX3NpZ25hbGluZy5zZW5kU2lnbmFsaW5nTWVzc2FnZSgnc29hYycsIHtcbiAgICAgIGlkOiB0aGlzLl9pbnRlcm5hbElkLFxuICAgICAgc2lnbmFsaW5nOiB7XG4gICAgICAgIHR5cGU6ICdjYW5kaWRhdGUnLFxuICAgICAgICBjYW5kaWRhdGU6IHtcbiAgICAgICAgICBjYW5kaWRhdGU6ICdhPScgKyBjYW5kaWRhdGUuY2FuZGlkYXRlLFxuICAgICAgICAgIHNkcE1pZDogY2FuZGlkYXRlLnNkcE1pZCxcbiAgICAgICAgICBzZHBNTGluZUluZGV4OiBjYW5kaWRhdGUuc2RwTUxpbmVJbmRleCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBfY3JlYXRlUGVlckNvbm5lY3Rpb24oKSB7XG4gICAgY29uc3QgcGNDb25maWd1cmF0aW9uID0gdGhpcy5fY29uZmlnLnJ0Y0NvbmZpZ3VyYXRpb24gfHwge307XG4gICAgaWYgKFV0aWxzLmlzQ2hyb21lKCkpIHtcbiAgICAgIHBjQ29uZmlndXJhdGlvbi5zZHBTZW1hbnRpY3MgPSAndW5pZmllZC1wbGFuJztcbiAgICB9XG4gICAgdGhpcy5fcGMgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24ocGNDb25maWd1cmF0aW9uKTtcbiAgICB0aGlzLl9wYy5vbmljZWNhbmRpZGF0ZSA9IChldmVudCkgPT4ge1xuICAgICAgdGhpcy5fb25Mb2NhbEljZUNhbmRpZGF0ZS5hcHBseSh0aGlzLCBbZXZlbnRdKTtcbiAgICB9O1xuICAgIHRoaXMuX3BjLm9udHJhY2sgPSAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMuX29uUmVtb3RlU3RyZWFtQWRkZWQuYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgfTtcbiAgICB0aGlzLl9wYy5vbmljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZSA9IChldmVudCkgPT4ge1xuICAgICAgdGhpcy5fb25JY2VDb25uZWN0aW9uU3RhdGVDaGFuZ2UuYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgfTtcbiAgICB0aGlzLl9wYy5vbmNvbm5lY3Rpb25zdGF0ZWNoYW5nZSA9IChldmVudCkgPT4ge1xuICAgICAgdGhpcy5fb25Db25uZWN0aW9uU3RhdGVDaGFuZ2UuYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgfTtcbiAgfVxuXG4gIF9nZXRTdGF0cygpIHtcbiAgICBpZiAodGhpcy5fcGMpIHtcbiAgICAgIHJldHVybiB0aGlzLl9wYy5nZXRTdGF0cygpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcihcbiAgICAgICAgICAnUGVlckNvbm5lY3Rpb24gaXMgbm90IGF2YWlsYWJsZS4nKSk7XG4gICAgfVxuICB9XG5cbiAgX3JlYWR5SGFuZGxlcigpIHtcbiAgICBpZiAodGhpcy5fc3Vic2NyaWJlUHJvbWlzZSkge1xuICAgICAgdGhpcy5fc3Vic2NyaXB0aW9uID0gbmV3IFN1YnNjcmlwdGlvbih0aGlzLl9pbnRlcm5hbElkLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlKCk7XG4gICAgICB9LCAoKSA9PiB0aGlzLl9nZXRTdGF0cygpLFxuICAgICAgKHRyYWNrS2luZCkgPT4gdGhpcy5fbXV0ZU9yVW5tdXRlKHRydWUsIGZhbHNlLCB0cmFja0tpbmQpLFxuICAgICAgKHRyYWNrS2luZCkgPT4gdGhpcy5fbXV0ZU9yVW5tdXRlKGZhbHNlLCBmYWxzZSwgdHJhY2tLaW5kKSxcbiAgICAgIChvcHRpb25zKSA9PiB0aGlzLl9hcHBseU9wdGlvbnMob3B0aW9ucykpO1xuICAgICAgLy8gRmlyZSBzdWJzY3JpcHRpb24ncyBlbmRlZCBldmVudCB3aGVuIGFzc29jaWF0ZWQgc3RyZWFtIGlzIGVuZGVkLlxuICAgICAgdGhpcy5fc3Vic2NyaWJlZFN0cmVhbS5hZGRFdmVudExpc3RlbmVyKCdlbmRlZCcsICgpID0+IHtcbiAgICAgICAgdGhpcy5fc3Vic2NyaXB0aW9uLmRpc3BhdGNoRXZlbnQoJ2VuZGVkJywgbmV3IE93dEV2ZW50KCdlbmRlZCcpKTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZS5yZXNvbHZlKHRoaXMuX3N1YnNjcmlwdGlvbik7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9wdWJsaXNoUHJvbWlzZSkge1xuICAgICAgdGhpcy5fcHVibGljYXRpb24gPSBuZXcgUHVibGljYXRpb24odGhpcy5faW50ZXJuYWxJZCwgKCkgPT4ge1xuICAgICAgICB0aGlzLl91bnB1Ymxpc2goKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSwgKCkgPT4gdGhpcy5fZ2V0U3RhdHMoKSxcbiAgICAgICh0cmFja0tpbmQpID0+IHRoaXMuX211dGVPclVubXV0ZSh0cnVlLCB0cnVlLCB0cmFja0tpbmQpLFxuICAgICAgKHRyYWNrS2luZCkgPT4gdGhpcy5fbXV0ZU9yVW5tdXRlKGZhbHNlLCB0cnVlLCB0cmFja0tpbmQpKTtcbiAgICAgIHRoaXMuX3B1Ymxpc2hQcm9taXNlLnJlc29sdmUodGhpcy5fcHVibGljYXRpb24pO1xuICAgICAgLy8gRG8gbm90IGZpcmUgcHVibGljYXRpb24ncyBlbmRlZCBldmVudCB3aGVuIGFzc29jaWF0ZWQgc3RyZWFtIGlzIGVuZGVkLlxuICAgICAgLy8gSXQgbWF5IHN0aWxsIHNlbmRpbmcgc2lsZW5jZSBvciBibGFjayBmcmFtZXMuXG4gICAgICAvLyBSZWZlciB0byBodHRwczovL3czYy5naXRodWIuaW8vd2VicnRjLXBjLyNydGNydHBzZW5kZXItaW50ZXJmYWNlLlxuICAgIH1cbiAgICB0aGlzLl9wdWJsaXNoUHJvbWlzZSA9IG51bGw7XG4gICAgdGhpcy5fc3Vic2NyaWJlUHJvbWlzZSA9IG51bGw7XG4gIH1cblxuICBfc2RwSGFuZGxlcihzZHApIHtcbiAgICBpZiAoc2RwLnR5cGUgPT09ICdhbnN3ZXInKSB7XG4gICAgICBpZiAoKHRoaXMuX3B1YmxpY2F0aW9uIHx8IHRoaXMuX3B1Ymxpc2hQcm9taXNlKSAmJiB0aGlzLl9vcHRpb25zKSB7XG4gICAgICAgIHNkcC5zZHAgPSB0aGlzLl9zZXRSdHBTZW5kZXJPcHRpb25zKHNkcC5zZHAsIHRoaXMuX29wdGlvbnMpO1xuICAgICAgfVxuICAgICAgdGhpcy5fcGMuc2V0UmVtb3RlRGVzY3JpcHRpb24oc2RwKS50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmdDYW5kaWRhdGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiB0aGlzLl9wZW5kaW5nQ2FuZGlkYXRlcykge1xuICAgICAgICAgICAgdGhpcy5fc2VuZENhbmRpZGF0ZShjYW5kaWRhdGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgIExvZ2dlci5lcnJvcignU2V0IHJlbW90ZSBkZXNjcmlwdGlvbiBmYWlsZWQ6ICcgKyBlcnJvcik7XG4gICAgICAgIHRoaXMuX3JlamVjdFByb21pc2UoZXJyb3IpO1xuICAgICAgICB0aGlzLl9maXJlRW5kZWRFdmVudE9uUHVibGljYXRpb25PclN1YnNjcmlwdGlvbigpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgX2Vycm9ySGFuZGxlcihlcnJvck1lc3NhZ2UpIHtcbiAgICByZXR1cm4gdGhpcy5faGFuZGxlRXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgfVxuXG4gIF9oYW5kbGVFcnJvcihlcnJvck1lc3NhZ2Upe1xuICAgIGNvbnN0IGVycm9yID0gbmV3IENvbmZlcmVuY2VFcnJvcihlcnJvck1lc3NhZ2UpO1xuICAgIGNvbnN0IHAgPSB0aGlzLl9wdWJsaXNoUHJvbWlzZSB8fCB0aGlzLl9zdWJzY3JpYmVQcm9taXNlO1xuICAgIGlmIChwKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcmVqZWN0UHJvbWlzZShlcnJvcik7XG4gICAgfVxuICAgIGlmICh0aGlzLl9lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkaXNwYXRjaGVyID0gdGhpcy5fcHVibGljYXRpb24gfHwgdGhpcy5fc3Vic2NyaXB0aW9uO1xuICAgIGlmICghZGlzcGF0Y2hlcikge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ05laXRoZXIgcHVibGljYXRpb24gbm9yIHN1YnNjcmlwdGlvbiBpcyBhdmFpbGFibGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnQgPSBuZXcgRXJyb3JFdmVudCgnZXJyb3InLCB7XG4gICAgICBlcnJvcjogZXJyb3IsXG4gICAgfSk7XG4gICAgZGlzcGF0Y2hlci5kaXNwYXRjaEV2ZW50KGVycm9yRXZlbnQpO1xuICAgIC8vIEZpcmUgZW5kZWQgZXZlbnQgd2hlbiBlcnJvciBvY2N1cmVkXG4gICAgdGhpcy5fZmlyZUVuZGVkRXZlbnRPblB1YmxpY2F0aW9uT3JTdWJzY3JpcHRpb24oKTtcbiAgfVxuXG4gIF9zZXRDb2RlY09yZGVyKHNkcCwgb3B0aW9ucykge1xuICAgIGlmICh0aGlzLl9wdWJsaWNhdGlvbiB8fCB0aGlzLl9wdWJsaXNoUHJvbWlzZSkge1xuICAgICAgaWYgKG9wdGlvbnMuYXVkaW8pIHtcbiAgICAgICAgY29uc3QgYXVkaW9Db2RlY05hbWVzID0gQXJyYXkuZnJvbShvcHRpb25zLmF1ZGlvLFxuICAgICAgICAgICAgKGVuY29kaW5nUGFyYW1ldGVycykgPT4gZW5jb2RpbmdQYXJhbWV0ZXJzLmNvZGVjLm5hbWUpO1xuICAgICAgICBzZHAgPSBTZHBVdGlscy5yZW9yZGVyQ29kZWNzKHNkcCwgJ2F1ZGlvJywgYXVkaW9Db2RlY05hbWVzKTtcbiAgICAgIH1cbiAgICAgIGlmIChvcHRpb25zLnZpZGVvKSB7XG4gICAgICAgIGNvbnN0IHZpZGVvQ29kZWNOYW1lcyA9IEFycmF5LmZyb20ob3B0aW9ucy52aWRlbyxcbiAgICAgICAgICAgIChlbmNvZGluZ1BhcmFtZXRlcnMpID0+IGVuY29kaW5nUGFyYW1ldGVycy5jb2RlYy5uYW1lKTtcbiAgICAgICAgc2RwID0gU2RwVXRpbHMucmVvcmRlckNvZGVjcyhzZHAsICd2aWRlbycsIHZpZGVvQ29kZWNOYW1lcyk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChvcHRpb25zLmF1ZGlvICYmIG9wdGlvbnMuYXVkaW8uY29kZWNzKSB7XG4gICAgICAgIGNvbnN0IGF1ZGlvQ29kZWNOYW1lcyA9IEFycmF5LmZyb20ob3B0aW9ucy5hdWRpby5jb2RlY3MsIChjb2RlYykgPT5cbiAgICAgICAgICBjb2RlYy5uYW1lKTtcbiAgICAgICAgc2RwID0gU2RwVXRpbHMucmVvcmRlckNvZGVjcyhzZHAsICdhdWRpbycsIGF1ZGlvQ29kZWNOYW1lcyk7XG4gICAgICB9XG4gICAgICBpZiAob3B0aW9ucy52aWRlbyAmJiBvcHRpb25zLnZpZGVvLmNvZGVjcykge1xuICAgICAgICBjb25zdCB2aWRlb0NvZGVjTmFtZXMgPSBBcnJheS5mcm9tKG9wdGlvbnMudmlkZW8uY29kZWNzLCAoY29kZWMpID0+XG4gICAgICAgICAgY29kZWMubmFtZSk7XG4gICAgICAgIHNkcCA9IFNkcFV0aWxzLnJlb3JkZXJDb2RlY3Moc2RwLCAndmlkZW8nLCB2aWRlb0NvZGVjTmFtZXMpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgX3NldE1heEJpdHJhdGUoc2RwLCBvcHRpb25zKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zLmF1ZGlvID09PSAnb2JqZWN0Jykge1xuICAgICAgc2RwID0gU2RwVXRpbHMuc2V0TWF4Qml0cmF0ZShzZHAsIG9wdGlvbnMuYXVkaW8pO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdGlvbnMudmlkZW8gPT09ICdvYmplY3QnKSB7XG4gICAgICBzZHAgPSBTZHBVdGlscy5zZXRNYXhCaXRyYXRlKHNkcCwgb3B0aW9ucy52aWRlbyk7XG4gICAgfVxuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICBfc2V0UnRwU2VuZGVyT3B0aW9ucyhzZHAsIG9wdGlvbnMpIHtcbiAgICAvLyBTRFAgbXVnbGluZyBpcyBkZXByZWNhdGVkLCBtb3ZpbmcgdG8gYHNldFBhcmFtZXRlcnNgLlxuICAgIGlmICh0aGlzLl9pc1J0cEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLmF1ZGlvKSB8fFxuICAgICAgICB0aGlzLl9pc1J0cEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLnZpZGVvKSkge1xuICAgICAgcmV0dXJuIHNkcDtcbiAgICB9XG4gICAgc2RwID0gdGhpcy5fc2V0TWF4Qml0cmF0ZShzZHAsIG9wdGlvbnMpO1xuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICBfc2V0UnRwUmVjZWl2ZXJPcHRpb25zKHNkcCwgb3B0aW9ucykge1xuICAgIC8vIEFkZCBsZWdhY3kgc2ltdWxjYXN0IGluIFNEUCBmb3Igc2FmYXJpLlxuICAgIGlmICh0aGlzLl9pc1J0cEVuY29kaW5nUGFyYW1ldGVycyhvcHRpb25zLnZpZGVvKSAmJiBVdGlscy5pc1NhZmFyaSgpKSB7XG4gICAgICBpZiAob3B0aW9ucy52aWRlby5sZW5ndGggPiAxKSB7XG4gICAgICAgIHNkcCA9IFNkcFV0aWxzLmFkZExlZ2FjeVNpbXVsY2FzdChzZHAsICd2aWRlbycsIG9wdGlvbnMudmlkZW8ubGVuZ3RoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBfdmlkZW9Db2RlY3MgaXMgYSB3b3JrYXJvdW5kIGZvciBzZXR0aW5nIHZpZGVvIGNvZGVjcy4gSXQgd2lsbCBiZSBtb3ZlZCB0byBSVENSdHBTZW5kUGFyYW1ldGVycy5cbiAgICBpZiAodGhpcy5faXNSdHBFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy52aWRlbykgJiYgdGhpcy5fdmlkZW9Db2RlY3MpIHtcbiAgICAgIHNkcCA9IFNkcFV0aWxzLnJlb3JkZXJDb2RlY3Moc2RwLCAndmlkZW8nLCB0aGlzLl92aWRlb0NvZGVjcyk7XG4gICAgICByZXR1cm4gc2RwO1xuICAgIH1cbiAgICBpZiAodGhpcy5faXNSdHBFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy5hdWRpbykgfHxcbiAgICAgICAgdGhpcy5faXNSdHBFbmNvZGluZ1BhcmFtZXRlcnMob3B0aW9ucy52aWRlbykpIHtcbiAgICAgIHJldHVybiBzZHA7XG4gICAgfVxuICAgIHNkcCA9IHRoaXMuX3NldENvZGVjT3JkZXIoc2RwLCBvcHRpb25zKTtcbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgLy8gSGFuZGxlIHN0cmVhbSBldmVudCBzZW50IGZyb20gTUNVLiBTb21lIHN0cmVhbSBldmVudHMgc2hvdWxkIGJlIHB1YmxpY2F0aW9uXG4gIC8vIGV2ZW50IG9yIHN1YnNjcmlwdGlvbiBldmVudC4gSXQgd2lsbCBiZSBoYW5kbGVkIGhlcmUuXG4gIF9vblN0cmVhbUV2ZW50KG1lc3NhZ2UpIHtcbiAgICBsZXQgZXZlbnRUYXJnZXQ7XG4gICAgaWYgKHRoaXMuX3B1YmxpY2F0aW9uICYmIG1lc3NhZ2UuaWQgPT09IHRoaXMuX3B1YmxpY2F0aW9uLmlkKSB7XG4gICAgICBldmVudFRhcmdldCA9IHRoaXMuX3B1YmxpY2F0aW9uO1xuICAgIH0gZWxzZSBpZiAoXG4gICAgICB0aGlzLl9zdWJzY3JpYmVkU3RyZWFtICYmIG1lc3NhZ2UuaWQgPT09IHRoaXMuX3N1YnNjcmliZWRTdHJlYW0uaWQpIHtcbiAgICAgIGV2ZW50VGFyZ2V0ID0gdGhpcy5fc3Vic2NyaXB0aW9uO1xuICAgIH1cbiAgICBpZiAoIWV2ZW50VGFyZ2V0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCB0cmFja0tpbmQ7XG4gICAgaWYgKG1lc3NhZ2UuZGF0YS5maWVsZCA9PT0gJ2F1ZGlvLnN0YXR1cycpIHtcbiAgICAgIHRyYWNrS2luZCA9IFRyYWNrS2luZC5BVURJTztcbiAgICB9IGVsc2UgaWYgKG1lc3NhZ2UuZGF0YS5maWVsZCA9PT0gJ3ZpZGVvLnN0YXR1cycpIHtcbiAgICAgIHRyYWNrS2luZCA9IFRyYWNrS2luZC5WSURFTztcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ0ludmFsaWQgZGF0YSBmaWVsZCBmb3Igc3RyZWFtIHVwZGF0ZSBpbmZvLicpO1xuICAgIH1cbiAgICBpZiAobWVzc2FnZS5kYXRhLnZhbHVlID09PSAnYWN0aXZlJykge1xuICAgICAgZXZlbnRUYXJnZXQuZGlzcGF0Y2hFdmVudChuZXcgTXV0ZUV2ZW50KCd1bm11dGUnLCB7a2luZDogdHJhY2tLaW5kfSkpO1xuICAgIH0gZWxzZSBpZiAobWVzc2FnZS5kYXRhLnZhbHVlID09PSAnaW5hY3RpdmUnKSB7XG4gICAgICBldmVudFRhcmdldC5kaXNwYXRjaEV2ZW50KG5ldyBNdXRlRXZlbnQoJ211dGUnLCB7a2luZDogdHJhY2tLaW5kfSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBMb2dnZXIud2FybmluZygnSW52YWxpZCBkYXRhIHZhbHVlIGZvciBzdHJlYW0gdXBkYXRlIGluZm8uJyk7XG4gICAgfVxuICB9XG5cbiAgX2lzUnRwRW5jb2RpbmdQYXJhbWV0ZXJzKG9iaikge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShvYmopKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIC8vIE9ubHkgY2hlY2sgdGhlIGZpcnN0IG9uZS5cbiAgICBjb25zdCBwYXJhbSA9IG9ialswXTtcbiAgICByZXR1cm4gcGFyYW0uY29kZWNQYXlsb2FkVHlwZSB8fCBwYXJhbS5kdHggfHwgcGFyYW0uYWN0aXZlIHx8IHBhcmFtXG4gICAgICAucHRpbWUgfHwgcGFyYW0ubWF4RnJhbWVyYXRlIHx8IHBhcmFtLnNjYWxlUmVzb2x1dGlvbkRvd25CeSB8fCBwYXJhbS5yaWQ7XG4gIH1cblxuICBfaXNPd3RFbmNvZGluZ1BhcmFtZXRlcnMob2JqKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gT25seSBjaGVjayB0aGUgZmlyc3Qgb25lLlxuICAgIGNvbnN0IHBhcmFtID0gb2JqWzBdO1xuICAgIHJldHVybiAhIXBhcmFtLmNvZGVjO1xuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8qIGdsb2JhbCBNYXAsIFByb21pc2UgKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG5pbXBvcnQgKiBhcyBFdmVudE1vZHVsZSBmcm9tICcuLi9iYXNlL2V2ZW50LmpzJztcbmltcG9ydCB7U2lvU2lnbmFsaW5nIGFzIFNpZ25hbGluZ30gZnJvbSAnLi9zaWduYWxpbmcuanMnO1xuaW1wb3J0IExvZ2dlciBmcm9tICcuLi9iYXNlL2xvZ2dlci5qcyc7XG5pbXBvcnQge0Jhc2U2NH0gZnJvbSAnLi4vYmFzZS9iYXNlNjQuanMnO1xuaW1wb3J0IHtDb25mZXJlbmNlRXJyb3J9IGZyb20gJy4vZXJyb3IuanMnO1xuaW1wb3J0ICogYXMgVXRpbHMgZnJvbSAnLi4vYmFzZS91dGlscy5qcyc7XG5pbXBvcnQgKiBhcyBTdHJlYW1Nb2R1bGUgZnJvbSAnLi4vYmFzZS9zdHJlYW0uanMnO1xuaW1wb3J0IHtQYXJ0aWNpcGFudH0gZnJvbSAnLi9wYXJ0aWNpcGFudC5qcyc7XG5pbXBvcnQge0NvbmZlcmVuY2VJbmZvfSBmcm9tICcuL2luZm8uanMnO1xuaW1wb3J0IHtDb25mZXJlbmNlUGVlckNvbm5lY3Rpb25DaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanMnO1xuaW1wb3J0IHtcbiAgUmVtb3RlTWl4ZWRTdHJlYW0sXG4gIEFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2VFdmVudCxcbiAgTGF5b3V0Q2hhbmdlRXZlbnQsXG59IGZyb20gJy4vbWl4ZWRzdHJlYW0uanMnO1xuaW1wb3J0ICogYXMgU3RyZWFtVXRpbHNNb2R1bGUgZnJvbSAnLi9zdHJlYW11dGlscy5qcyc7XG5cbmNvbnN0IFNpZ25hbGluZ1N0YXRlID0ge1xuICBSRUFEWTogMSxcbiAgQ09OTkVDVElORzogMixcbiAgQ09OTkVDVEVEOiAzLFxufTtcblxuY29uc3QgcHJvdG9jb2xWZXJzaW9uID0gJzEuMSc7XG5cbi8qIGVzbGludC1kaXNhYmxlIHZhbGlkLWpzZG9jICovXG4vKipcbiAqIEBjbGFzcyBQYXJ0aWNpcGFudEV2ZW50XG4gKiBAY2xhc3NEZXNjIENsYXNzIFBhcnRpY2lwYW50RXZlbnQgcmVwcmVzZW50cyBhIHBhcnRpY2lwYW50IGV2ZW50LlxuICAgQGV4dGVuZHMgT3d0LkJhc2UuT3d0RXZlbnRcbiAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZVxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5jb25zdCBQYXJ0aWNpcGFudEV2ZW50ID0gZnVuY3Rpb24odHlwZSwgaW5pdCkge1xuICBjb25zdCB0aGF0ID0gbmV3IEV2ZW50TW9kdWxlLk93dEV2ZW50KHR5cGUsIGluaXQpO1xuICAvKipcbiAgICogQG1lbWJlciB7T3d0LkNvbmZlcmVuY2UuUGFydGljaXBhbnR9IHBhcnRpY2lwYW50XG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuUGFydGljaXBhbnRFdmVudFxuICAgKi9cbiAgdGhhdC5wYXJ0aWNpcGFudCA9IGluaXQucGFydGljaXBhbnQ7XG4gIHJldHVybiB0aGF0O1xufTtcbi8qIGVzbGludC1lbmFibGUgdmFsaWQtanNkb2MgKi9cblxuLyoqXG4gKiBAY2xhc3MgQ29uZmVyZW5jZUNsaWVudENvbmZpZ3VyYXRpb25cbiAqIEBjbGFzc0Rlc2MgQ29uZmlndXJhdGlvbiBmb3IgQ29uZmVyZW5jZUNsaWVudC5cbiAqIEBtZW1iZXJPZiBPd3QuQ29uZmVyZW5jZVxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5jbGFzcyBDb25mZXJlbmNlQ2xpZW50Q29uZmlndXJhdGlvbiB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P1JUQ0NvbmZpZ3VyYXRpb259IHJ0Y0NvbmZpZ3VyYXRpb25cbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuQ29uZmVyZW5jZUNsaWVudENvbmZpZ3VyYXRpb25cbiAgICAgKiBAZGVzYyBJdCB3aWxsIGJlIHVzZWQgZm9yIGNyZWF0aW5nIFBlZXJDb25uZWN0aW9uLlxuICAgICAqIEBzZWUge0BsaW5rIGh0dHBzOi8vd3d3LnczLm9yZy9UUi93ZWJydGMvI3J0Y2NvbmZpZ3VyYXRpb24tZGljdGlvbmFyeXxSVENDb25maWd1cmF0aW9uIERpY3Rpb25hcnkgb2YgV2ViUlRDIDEuMH0uXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiAvLyBGb2xsb3dpbmcgb2JqZWN0IGNhbiBiZSBzZXQgdG8gY29uZmVyZW5jZUNsaWVudENvbmZpZ3VyYXRpb24ucnRjQ29uZmlndXJhdGlvbi5cbiAgICAgKiB7XG4gICAgICogICBpY2VTZXJ2ZXJzOiBbe1xuICAgICAqICAgICAgdXJsczogXCJzdHVuOmV4YW1wbGUuY29tOjM0NzhcIlxuICAgICAqICAgfSwge1xuICAgICAqICAgICB1cmxzOiBbXG4gICAgICogICAgICAgXCJ0dXJuOmV4YW1wbGUuY29tOjM0Nzg/dHJhbnNwb3J0PXVkcFwiLFxuICAgICAqICAgICAgIFwidHVybjpleGFtcGxlLmNvbTozNDc4P3RyYW5zcG9ydD10Y3BcIlxuICAgICAqICAgICBdLFxuICAgICAqICAgICAgY3JlZGVudGlhbDogXCJwYXNzd29yZFwiLFxuICAgICAqICAgICAgdXNlcm5hbWU6IFwidXNlcm5hbWVcIlxuICAgICAqICAgfVxuICAgICAqIH1cbiAgICAgKi9cbiAgICB0aGlzLnJ0Y0NvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgQ29uZmVyZW5jZUNsaWVudFxuICogQGNsYXNzZGVzYyBUaGUgQ29uZmVyZW5jZUNsaWVudCBoYW5kbGVzIFBlZXJDb25uZWN0aW9ucyBiZXR3ZWVuIGNsaWVudCBhbmQgc2VydmVyLiBGb3IgY29uZmVyZW5jZSBjb250cm9sbGluZywgcGxlYXNlIHJlZmVyIHRvIFJFU1QgQVBJIGd1aWRlLlxuICogRXZlbnRzOlxuICpcbiAqIHwgRXZlbnQgTmFtZSAgICAgICAgICAgIHwgQXJndW1lbnQgVHlwZSAgICAgICAgICAgICAgICAgICAgfCBGaXJlZCB3aGVuICAgICAgIHxcbiAqIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tfCAtLS0tLS0tLS0tLS0tLS0tIHxcbiAqIHwgc3RyZWFtYWRkZWQgICAgICAgICAgIHwgT3d0LkJhc2UuU3RyZWFtRXZlbnQgICAgICAgICAgICAgfCBBIG5ldyBzdHJlYW0gaXMgYXZhaWxhYmxlIGluIHRoZSBjb25mZXJlbmNlLiB8XG4gKiB8IHBhcnRpY2lwYW50am9pbmVkICAgICB8IE93dC5Db25mZXJlbmNlLlBhcnRpY2lwYW50RXZlbnQgIHwgQSBuZXcgcGFydGljaXBhbnQgam9pbmVkIHRoZSBjb25mZXJlbmNlLiB8XG4gKiB8IG1lc3NhZ2VyZWNlaXZlZCAgICAgICB8IE93dC5CYXNlLk1lc3NhZ2VFdmVudCAgICAgICAgICAgIHwgQSBuZXcgbWVzc2FnZSBpcyByZWNlaXZlZC4gfFxuICogfCBzZXJ2ZXJkaXNjb25uZWN0ZWQgICAgfCBPd3QuQmFzZS5Pd3RFdmVudCAgICAgICAgICAgICAgICB8IERpc2Nvbm5lY3RlZCBmcm9tIGNvbmZlcmVuY2Ugc2VydmVyLiB8XG4gKlxuICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlXG4gKiBAZXh0ZW5kcyBPd3QuQmFzZS5FdmVudERpc3BhdGNoZXJcbiAqIEBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHs/T3d0LkNvbmZlcmVuY2UuQ29uZmVyZW5jZUNsaWVudENvbmZpZ3VyYXRpb24gfSBjb25maWcgQ29uZmlndXJhdGlvbiBmb3IgQ29uZmVyZW5jZUNsaWVudC5cbiAqIEBwYXJhbSB7P093dC5Db25mZXJlbmNlLlNpb1NpZ25hbGluZyB9IHNpZ25hbGluZ0ltcGwgU2lnbmFsaW5nIGNoYW5uZWwgaW1wbGVtZW50YXRpb24gZm9yIENvbmZlcmVuY2VDbGllbnQuIFNESyB1c2VzIGRlZmF1bHQgc2lnbmFsaW5nIGNoYW5uZWwgaW1wbGVtZW50YXRpb24gaWYgdGhpcyBwYXJhbWV0ZXIgaXMgdW5kZWZpbmVkLiBDdXJyZW50bHksIGEgU29ja2V0LklPIHNpZ25hbGluZyBjaGFubmVsIGltcGxlbWVudGF0aW9uIHdhcyBwcm92aWRlZCBhcyBpY3MuY29uZmVyZW5jZS5TaW9TaWduYWxpbmcuIEhvd2V2ZXIsIGl0IGlzIG5vdCByZWNvbW1lbmRlZCB0byBkaXJlY3RseSBhY2Nlc3Mgc2lnbmFsaW5nIGNoYW5uZWwgb3IgY3VzdG9taXplIHNpZ25hbGluZyBjaGFubmVsIGZvciBDb25mZXJlbmNlQ2xpZW50IGFzIHRoaXMgdGltZS5cbiAqL1xuZXhwb3J0IGNvbnN0IENvbmZlcmVuY2VDbGllbnQgPSBmdW5jdGlvbihjb25maWcsIHNpZ25hbGluZ0ltcGwpIHtcbiAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIG5ldyBFdmVudE1vZHVsZS5FdmVudERpc3BhdGNoZXIoKSk7XG4gIGNvbmZpZyA9IGNvbmZpZyB8fCB7fTtcbiAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gIGxldCBzaWduYWxpbmdTdGF0ZSA9IFNpZ25hbGluZ1N0YXRlLlJFQURZO1xuICBjb25zdCBzaWduYWxpbmcgPSBzaWduYWxpbmdJbXBsID8gc2lnbmFsaW5nSW1wbCA6IChuZXcgU2lnbmFsaW5nKCkpO1xuICBsZXQgbWU7XG4gIGxldCByb29tO1xuICBjb25zdCByZW1vdGVTdHJlYW1zID0gbmV3IE1hcCgpOyAvLyBLZXkgaXMgc3RyZWFtIElELCB2YWx1ZSBpcyBhIFJlbW90ZVN0cmVhbS5cbiAgY29uc3QgcGFydGljaXBhbnRzID0gbmV3IE1hcCgpOyAvLyBLZXkgaXMgcGFydGljaXBhbnQgSUQsIHZhbHVlIGlzIGEgUGFydGljaXBhbnQgb2JqZWN0LlxuICBjb25zdCBwdWJsaXNoQ2hhbm5lbHMgPSBuZXcgTWFwKCk7IC8vIEtleSBpcyBNZWRpYVN0cmVhbSdzIElELCB2YWx1ZSBpcyBwYyBjaGFubmVsLlxuICBjb25zdCBjaGFubmVscyA9IG5ldyBNYXAoKTsgLy8gS2V5IGlzIGNoYW5uZWwncyBpbnRlcm5hbCBJRCwgdmFsdWUgaXMgY2hhbm5lbC5cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIG9uU2lnbmFsaW5nTWVzc2FnZVxuICAgKiBAZGVzYyBSZWNlaXZlZCBhIG1lc3NhZ2UgZnJvbSBjb25mZXJlbmNlIHBvcnRhbC4gRGVmaW5lZCBpbiBjbGllbnQtc2VydmVyIHByb3RvY29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbm90aWZpY2F0aW9uIE5vdGlmaWNhdGlvbiB0eXBlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gZGF0YSBEYXRhIHJlY2VpdmVkLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgZnVuY3Rpb24gb25TaWduYWxpbmdNZXNzYWdlKG5vdGlmaWNhdGlvbiwgZGF0YSkge1xuICAgIGlmIChub3RpZmljYXRpb24gPT09ICdzb2FjJyB8fCBub3RpZmljYXRpb24gPT09ICdwcm9ncmVzcycpIHtcbiAgICAgIGlmICghY2hhbm5lbHMuaGFzKGRhdGEuaWQpKSB7XG4gICAgICAgIExvZ2dlci53YXJuaW5nKCdDYW5ub3QgZmluZCBhIGNoYW5uZWwgZm9yIGluY29taW5nIGRhdGEuJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNoYW5uZWxzLmdldChkYXRhLmlkKS5vbk1lc3NhZ2Uobm90aWZpY2F0aW9uLCBkYXRhKTtcbiAgICB9IGVsc2UgaWYgKG5vdGlmaWNhdGlvbiA9PT0gJ3N0cmVhbScpIHtcbiAgICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ2FkZCcpIHtcbiAgICAgICAgZmlyZVN0cmVhbUFkZGVkKGRhdGEuZGF0YSk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEuc3RhdHVzID09PSAncmVtb3ZlJykge1xuICAgICAgICBmaXJlU3RyZWFtUmVtb3ZlZChkYXRhKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YS5zdGF0dXMgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgIC8vIEJyb2FkY2FzdCBhdWRpby92aWRlbyB1cGRhdGUgc3RhdHVzIHRvIGNoYW5uZWwgc28gc3BlY2lmaWMgZXZlbnRzIGNhbiBiZSBmaXJlZCBvbiBwdWJsaWNhdGlvbiBvciBzdWJzY3JpcHRpb24uXG4gICAgICAgIGlmIChkYXRhLmRhdGEuZmllbGQgPT09ICdhdWRpby5zdGF0dXMnIHx8IGRhdGEuZGF0YS5maWVsZCA9PT1cbiAgICAgICAgICAndmlkZW8uc3RhdHVzJykge1xuICAgICAgICAgIGNoYW5uZWxzLmZvckVhY2goKGMpID0+IHtcbiAgICAgICAgICAgIGMub25NZXNzYWdlKG5vdGlmaWNhdGlvbiwgZGF0YSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS5kYXRhLmZpZWxkID09PSAnYWN0aXZlSW5wdXQnKSB7XG4gICAgICAgICAgZmlyZUFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2UoZGF0YSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS5kYXRhLmZpZWxkID09PSAndmlkZW8ubGF5b3V0Jykge1xuICAgICAgICAgIGZpcmVMYXlvdXRDaGFuZ2UoZGF0YSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS5kYXRhLmZpZWxkID09PSAnLicpIHtcbiAgICAgICAgICB1cGRhdGVSZW1vdGVTdHJlYW0oZGF0YS5kYXRhLnZhbHVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBMb2dnZXIud2FybmluZygnVW5rbm93biBzdHJlYW0gZXZlbnQgZnJvbSBNQ1UuJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKG5vdGlmaWNhdGlvbiA9PT0gJ3RleHQnKSB7XG4gICAgICBmaXJlTWVzc2FnZVJlY2VpdmVkKGRhdGEpO1xuICAgIH0gZWxzZSBpZiAobm90aWZpY2F0aW9uID09PSAncGFydGljaXBhbnQnKSB7XG4gICAgICBmaXJlUGFydGljaXBhbnRFdmVudChkYXRhKTtcbiAgICB9XG4gIH1cblxuICBzaWduYWxpbmcuYWRkRXZlbnRMaXN0ZW5lcignZGF0YScsIChldmVudCkgPT4ge1xuICAgIG9uU2lnbmFsaW5nTWVzc2FnZShldmVudC5tZXNzYWdlLm5vdGlmaWNhdGlvbiwgZXZlbnQubWVzc2FnZS5kYXRhKTtcbiAgfSk7XG5cbiAgc2lnbmFsaW5nLmFkZEV2ZW50TGlzdGVuZXIoJ2Rpc2Nvbm5lY3QnLCAoKSA9PiB7XG4gICAgY2xlYW4oKTtcbiAgICBzaWduYWxpbmdTdGF0ZSA9IFNpZ25hbGluZ1N0YXRlLlJFQURZO1xuICAgIHNlbGYuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnRNb2R1bGUuT3d0RXZlbnQoJ3NlcnZlcmRpc2Nvbm5lY3RlZCcpKTtcbiAgfSk7XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gZmlyZVBhcnRpY2lwYW50RXZlbnQoZGF0YSkge1xuICAgIGlmIChkYXRhLmFjdGlvbiA9PT0gJ2pvaW4nKSB7XG4gICAgICBkYXRhID0gZGF0YS5kYXRhO1xuICAgICAgY29uc3QgcGFydGljaXBhbnQgPSBuZXcgUGFydGljaXBhbnQoZGF0YS5pZCwgZGF0YS5yb2xlLCBkYXRhLnVzZXIpO1xuICAgICAgcGFydGljaXBhbnRzLnNldChkYXRhLmlkLCBwYXJ0aWNpcGFudCk7XG4gICAgICBjb25zdCBldmVudCA9IG5ldyBQYXJ0aWNpcGFudEV2ZW50KFxuICAgICAgICAgICdwYXJ0aWNpcGFudGpvaW5lZCcsIHtwYXJ0aWNpcGFudDogcGFydGljaXBhbnR9KTtcbiAgICAgIHNlbGYuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgfSBlbHNlIGlmIChkYXRhLmFjdGlvbiA9PT0gJ2xlYXZlJykge1xuICAgICAgY29uc3QgcGFydGljaXBhbnRJZCA9IGRhdGEuZGF0YTtcbiAgICAgIGlmICghcGFydGljaXBhbnRzLmhhcyhwYXJ0aWNpcGFudElkKSkge1xuICAgICAgICBMb2dnZXIud2FybmluZyhcbiAgICAgICAgICAgICdSZWNlaXZlZCBsZWF2ZSBtZXNzYWdlIGZyb20gTUNVIGZvciBhbiB1bmtub3duIHBhcnRpY2lwYW50LicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwYXJ0aWNpcGFudCA9IHBhcnRpY2lwYW50cy5nZXQocGFydGljaXBhbnRJZCk7XG4gICAgICBwYXJ0aWNpcGFudHMuZGVsZXRlKHBhcnRpY2lwYW50SWQpO1xuICAgICAgcGFydGljaXBhbnQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnRNb2R1bGUuT3d0RXZlbnQoJ2xlZnQnKSk7XG4gICAgfVxuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gZmlyZU1lc3NhZ2VSZWNlaXZlZChkYXRhKSB7XG4gICAgY29uc3QgbWVzc2FnZUV2ZW50ID0gbmV3IEV2ZW50TW9kdWxlLk1lc3NhZ2VFdmVudCgnbWVzc2FnZXJlY2VpdmVkJywge1xuICAgICAgbWVzc2FnZTogZGF0YS5tZXNzYWdlLFxuICAgICAgb3JpZ2luOiBkYXRhLmZyb20sXG4gICAgICB0bzogZGF0YS50byxcbiAgICB9KTtcbiAgICBzZWxmLmRpc3BhdGNoRXZlbnQobWVzc2FnZUV2ZW50KTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGZ1bmN0aW9uIGZpcmVTdHJlYW1BZGRlZChpbmZvKSB7XG4gICAgY29uc3Qgc3RyZWFtID0gY3JlYXRlUmVtb3RlU3RyZWFtKGluZm8pO1xuICAgIHJlbW90ZVN0cmVhbXMuc2V0KHN0cmVhbS5pZCwgc3RyZWFtKTtcbiAgICBjb25zdCBzdHJlYW1FdmVudCA9IG5ldyBTdHJlYW1Nb2R1bGUuU3RyZWFtRXZlbnQoJ3N0cmVhbWFkZGVkJywge1xuICAgICAgc3RyZWFtOiBzdHJlYW0sXG4gICAgfSk7XG4gICAgc2VsZi5kaXNwYXRjaEV2ZW50KHN0cmVhbUV2ZW50KTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGZ1bmN0aW9uIGZpcmVTdHJlYW1SZW1vdmVkKGluZm8pIHtcbiAgICBpZiAoIXJlbW90ZVN0cmVhbXMuaGFzKGluZm8uaWQpKSB7XG4gICAgICBMb2dnZXIud2FybmluZygnQ2Fubm90IGZpbmQgc3BlY2lmaWMgcmVtb3RlIHN0cmVhbS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgc3RyZWFtID0gcmVtb3RlU3RyZWFtcy5nZXQoaW5mby5pZCk7XG4gICAgY29uc3Qgc3RyZWFtRXZlbnQgPSBuZXcgRXZlbnRNb2R1bGUuT3d0RXZlbnQoJ2VuZGVkJyk7XG4gICAgcmVtb3RlU3RyZWFtcy5kZWxldGUoc3RyZWFtLmlkKTtcbiAgICBzdHJlYW0uZGlzcGF0Y2hFdmVudChzdHJlYW1FdmVudCk7XG4gIH1cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBmdW5jdGlvbiBmaXJlQWN0aXZlQXVkaW9JbnB1dENoYW5nZShpbmZvKSB7XG4gICAgaWYgKCFyZW1vdGVTdHJlYW1zLmhhcyhpbmZvLmlkKSkge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ0Nhbm5vdCBmaW5kIHNwZWNpZmljIHJlbW90ZSBzdHJlYW0uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHN0cmVhbSA9IHJlbW90ZVN0cmVhbXMuZ2V0KGluZm8uaWQpO1xuICAgIGNvbnN0IHN0cmVhbUV2ZW50ID0gbmV3IEFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2VFdmVudChcbiAgICAgICAgJ2FjdGl2ZWF1ZGlvaW5wdXRjaGFuZ2UnLCB7XG4gICAgICAgICAgYWN0aXZlQXVkaW9JbnB1dFN0cmVhbUlkOiBpbmZvLmRhdGEudmFsdWUsXG4gICAgICAgIH0pO1xuICAgIHN0cmVhbS5kaXNwYXRjaEV2ZW50KHN0cmVhbUV2ZW50KTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGZ1bmN0aW9uIGZpcmVMYXlvdXRDaGFuZ2UoaW5mbykge1xuICAgIGlmICghcmVtb3RlU3RyZWFtcy5oYXMoaW5mby5pZCkpIHtcbiAgICAgIExvZ2dlci53YXJuaW5nKCdDYW5ub3QgZmluZCBzcGVjaWZpYyByZW1vdGUgc3RyZWFtLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBzdHJlYW0gPSByZW1vdGVTdHJlYW1zLmdldChpbmZvLmlkKTtcbiAgICBjb25zdCBzdHJlYW1FdmVudCA9IG5ldyBMYXlvdXRDaGFuZ2VFdmVudChcbiAgICAgICAgJ2xheW91dGNoYW5nZScsIHtcbiAgICAgICAgICBsYXlvdXQ6IGluZm8uZGF0YS52YWx1ZSxcbiAgICAgICAgfSk7XG4gICAgc3RyZWFtLmRpc3BhdGNoRXZlbnQoc3RyZWFtRXZlbnQpO1xuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gdXBkYXRlUmVtb3RlU3RyZWFtKHN0cmVhbUluZm8pIHtcbiAgICBpZiAoIXJlbW90ZVN0cmVhbXMuaGFzKHN0cmVhbUluZm8uaWQpKSB7XG4gICAgICBMb2dnZXIud2FybmluZygnQ2Fubm90IGZpbmQgc3BlY2lmaWMgcmVtb3RlIHN0cmVhbS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgc3RyZWFtID0gcmVtb3RlU3RyZWFtcy5nZXQoc3RyZWFtSW5mby5pZCk7XG4gICAgc3RyZWFtLnNldHRpbmdzID0gU3RyZWFtVXRpbHNNb2R1bGUuY29udmVydFRvUHVibGljYXRpb25TZXR0aW5ncyhzdHJlYW1JbmZvXG4gICAgICAgIC5tZWRpYSk7XG4gICAgc3RyZWFtLmV4dHJhQ2FwYWJpbGl0aWVzID0gU3RyZWFtVXRpbHNNb2R1bGVcbiAgICAgIC5jb252ZXJ0VG9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXMoXG4gICAgICAgIHN0cmVhbUluZm8ubWVkaWEpO1xuICAgIGNvbnN0IHN0cmVhbUV2ZW50ID0gbmV3IEV2ZW50TW9kdWxlLk93dEV2ZW50KCd1cGRhdGVkJyk7XG4gICAgc3RyZWFtLmRpc3BhdGNoRXZlbnQoc3RyZWFtRXZlbnQpO1xuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gY3JlYXRlUmVtb3RlU3RyZWFtKHN0cmVhbUluZm8pIHtcbiAgICBpZiAoc3RyZWFtSW5mby50eXBlID09PSAnbWl4ZWQnKSB7XG4gICAgICByZXR1cm4gbmV3IFJlbW90ZU1peGVkU3RyZWFtKHN0cmVhbUluZm8pO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgYXVkaW9Tb3VyY2VJbmZvOyBsZXQgdmlkZW9Tb3VyY2VJbmZvO1xuICAgICAgaWYgKHN0cmVhbUluZm8ubWVkaWEuYXVkaW8pIHtcbiAgICAgICAgYXVkaW9Tb3VyY2VJbmZvID0gc3RyZWFtSW5mby5tZWRpYS5hdWRpby5zb3VyY2U7XG4gICAgICB9XG4gICAgICBpZiAoc3RyZWFtSW5mby5tZWRpYS52aWRlbykge1xuICAgICAgICB2aWRlb1NvdXJjZUluZm8gPSBzdHJlYW1JbmZvLm1lZGlhLnZpZGVvLnNvdXJjZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBTdHJlYW1Nb2R1bGUuUmVtb3RlU3RyZWFtKHN0cmVhbUluZm8uaWQsXG4gICAgICAgICAgc3RyZWFtSW5mby5pbmZvLm93bmVyLCB1bmRlZmluZWQsIG5ldyBTdHJlYW1Nb2R1bGUuU3RyZWFtU291cmNlSW5mbyhcbiAgICAgICAgICAgICAgYXVkaW9Tb3VyY2VJbmZvLCB2aWRlb1NvdXJjZUluZm8pLCBzdHJlYW1JbmZvLmluZm8uYXR0cmlidXRlcyk7XG4gICAgICBzdHJlYW0uc2V0dGluZ3MgPSBTdHJlYW1VdGlsc01vZHVsZS5jb252ZXJ0VG9QdWJsaWNhdGlvblNldHRpbmdzKFxuICAgICAgICAgIHN0cmVhbUluZm8ubWVkaWEpO1xuICAgICAgc3RyZWFtLmV4dHJhQ2FwYWJpbGl0aWVzID0gU3RyZWFtVXRpbHNNb2R1bGVcbiAgICAgICAgLmNvbnZlcnRUb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyhcbiAgICAgICAgICBzdHJlYW1JbmZvLm1lZGlhKTtcbiAgICAgIHJldHVybiBzdHJlYW07XG4gICAgfVxuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gc2VuZFNpZ25hbGluZ01lc3NhZ2UodHlwZSwgbWVzc2FnZSkge1xuICAgIHJldHVybiBzaWduYWxpbmcuc2VuZCh0eXBlLCBtZXNzYWdlKTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGZ1bmN0aW9uIGNyZWF0ZVBlZXJDb25uZWN0aW9uQ2hhbm5lbCgpIHtcbiAgICAvLyBDb25zdHJ1Y3QgYW4gc2lnbmFsaW5nIHNlbmRlci9yZWNlaXZlciBmb3IgQ29uZmVyZW5jZVBlZXJDb25uZWN0aW9uLlxuICAgIGNvbnN0IHNpZ25hbGluZ0ZvckNoYW5uZWwgPSBPYmplY3QuY3JlYXRlKEV2ZW50TW9kdWxlLkV2ZW50RGlzcGF0Y2hlcik7XG4gICAgc2lnbmFsaW5nRm9yQ2hhbm5lbC5zZW5kU2lnbmFsaW5nTWVzc2FnZSA9IHNlbmRTaWduYWxpbmdNZXNzYWdlO1xuICAgIGNvbnN0IHBjYyA9IG5ldyBDb25mZXJlbmNlUGVlckNvbm5lY3Rpb25DaGFubmVsKFxuICAgICAgICBjb25maWcsIHNpZ25hbGluZ0ZvckNoYW5uZWwpO1xuICAgIHBjYy5hZGRFdmVudExpc3RlbmVyKCdpZCcsIChtZXNzYWdlRXZlbnQpID0+IHtcbiAgICAgIGNoYW5uZWxzLnNldChtZXNzYWdlRXZlbnQubWVzc2FnZSwgcGNjKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcGNjO1xuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgZnVuY3Rpb24gY2xlYW4oKSB7XG4gICAgcGFydGljaXBhbnRzLmNsZWFyKCk7XG4gICAgcmVtb3RlU3RyZWFtcy5jbGVhcigpO1xuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdpbmZvJywge1xuICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgZ2V0OiAoKSA9PiB7XG4gICAgICBpZiAoIXJvb20pIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IENvbmZlcmVuY2VJbmZvKHJvb20uaWQsIEFycmF5LmZyb20ocGFydGljaXBhbnRzLCAoeCkgPT4geFtcbiAgICAgICAgICAxXSksIEFycmF5LmZyb20ocmVtb3RlU3RyZWFtcywgKHgpID0+IHhbMV0pLCBtZSk7XG4gICAgfSxcbiAgfSk7XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBqb2luXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBKb2luIGEgY29uZmVyZW5jZS5cbiAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkNvbmZlcmVuY2VDbGllbnRcbiAgICogQHJldHVybnMge1Byb21pc2U8Q29uZmVyZW5jZUluZm8sIEVycm9yPn0gUmV0dXJuIGEgcHJvbWlzZSByZXNvbHZlZCB3aXRoIGN1cnJlbnQgY29uZmVyZW5jZSdzIGluZm9ybWF0aW9uIGlmIHN1Y2Nlc3NmdWxseSBqb2luIHRoZSBjb25mZXJlbmNlLiBPciByZXR1cm4gYSBwcm9taXNlIHJlamVjdGVkIHdpdGggYSBuZXdseSBjcmVhdGVkIE93dC5FcnJvciBpZiBmYWlsZWQgdG8gam9pbiB0aGUgY29uZmVyZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRva2VuU3RyaW5nIFRva2VuIGlzIGlzc3VlZCBieSBjb25mZXJlbmNlIHNlcnZlcihudXZlKS5cbiAgICovXG4gIHRoaXMuam9pbiA9IGZ1bmN0aW9uKHRva2VuU3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHRva2VuID0gSlNPTi5wYXJzZShCYXNlNjQuZGVjb2RlQmFzZTY0KHRva2VuU3RyaW5nKSk7XG4gICAgICBjb25zdCBpc1NlY3VyZWQgPSAodG9rZW4uc2VjdXJlID09PSB0cnVlKTtcbiAgICAgIGxldCBob3N0ID0gdG9rZW4uaG9zdDtcbiAgICAgIGlmICh0eXBlb2YgaG9zdCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmVqZWN0KG5ldyBDb25mZXJlbmNlRXJyb3IoJ0ludmFsaWQgaG9zdC4nKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChob3N0LmluZGV4T2YoJ2h0dHAnKSA9PT0gLTEpIHtcbiAgICAgICAgaG9zdCA9IGlzU2VjdXJlZCA/ICgnaHR0cHM6Ly8nICsgaG9zdCkgOiAoJ2h0dHA6Ly8nICsgaG9zdCk7XG4gICAgICB9XG4gICAgICBpZiAoc2lnbmFsaW5nU3RhdGUgIT09IFNpZ25hbGluZ1N0YXRlLlJFQURZKSB7XG4gICAgICAgIHJlamVjdChuZXcgQ29uZmVyZW5jZUVycm9yKCdjb25uZWN0aW9uIHN0YXRlIGludmFsaWQnKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgc2lnbmFsaW5nU3RhdGUgPSBTaWduYWxpbmdTdGF0ZS5DT05ORUNUSU5HO1xuXG4gICAgICBjb25zdCBsb2dpbkluZm8gPSB7XG4gICAgICAgIHRva2VuOiB0b2tlblN0cmluZyxcbiAgICAgICAgdXNlckFnZW50OiBVdGlscy5zeXNJbmZvKCksXG4gICAgICAgIHByb3RvY29sOiBwcm90b2NvbFZlcnNpb24sXG4gICAgICB9O1xuXG4gICAgICBzaWduYWxpbmcuY29ubmVjdChob3N0LCBpc1NlY3VyZWQsIGxvZ2luSW5mbykudGhlbigocmVzcCkgPT4ge1xuICAgICAgICBzaWduYWxpbmdTdGF0ZSA9IFNpZ25hbGluZ1N0YXRlLkNPTk5FQ1RFRDtcbiAgICAgICAgcm9vbSA9IHJlc3Aucm9vbTtcbiAgICAgICAgaWYgKHJvb20uc3RyZWFtcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBzdCBvZiByb29tLnN0cmVhbXMpIHtcbiAgICAgICAgICAgIGlmIChzdC50eXBlID09PSAnbWl4ZWQnKSB7XG4gICAgICAgICAgICAgIHN0LnZpZXdwb3J0ID0gc3QuaW5mby5sYWJlbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbW90ZVN0cmVhbXMuc2V0KHN0LmlkLCBjcmVhdGVSZW1vdGVTdHJlYW0oc3QpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3Aucm9vbSAmJiByZXNwLnJvb20ucGFydGljaXBhbnRzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcmVzcC5yb29tLnBhcnRpY2lwYW50cykge1xuICAgICAgICAgICAgcGFydGljaXBhbnRzLnNldChwLmlkLCBuZXcgUGFydGljaXBhbnQocC5pZCwgcC5yb2xlLCBwLnVzZXIpKTtcbiAgICAgICAgICAgIGlmIChwLmlkID09PSByZXNwLmlkKSB7XG4gICAgICAgICAgICAgIG1lID0gcGFydGljaXBhbnRzLmdldChwLmlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmVzb2x2ZShuZXcgQ29uZmVyZW5jZUluZm8ocmVzcC5yb29tLmlkLCBBcnJheS5mcm9tKHBhcnRpY2lwYW50c1xuICAgICAgICAgICAgLnZhbHVlcygpKSwgQXJyYXkuZnJvbShyZW1vdGVTdHJlYW1zLnZhbHVlcygpKSwgbWUpKTtcbiAgICAgIH0sIChlKSA9PiB7XG4gICAgICAgIHNpZ25hbGluZ1N0YXRlID0gU2lnbmFsaW5nU3RhdGUuUkVBRFk7XG4gICAgICAgIHJlamVjdChuZXcgQ29uZmVyZW5jZUVycm9yKGUpKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gcHVibGlzaFxuICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuQ29uZmVyZW5jZUNsaWVudFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgUHVibGlzaCBhIExvY2FsU3RyZWFtIHRvIGNvbmZlcmVuY2Ugc2VydmVyLiBPdGhlciBwYXJ0aWNpcGFudHMgd2lsbCBiZSBhYmxlIHRvIHN1YnNjcmliZSB0aGlzIHN0cmVhbSB3aGVuIGl0IGlzIHN1Y2Nlc3NmdWxseSBwdWJsaXNoZWQuXG4gICAqIEBwYXJhbSB7T3d0LkJhc2UuTG9jYWxTdHJlYW19IHN0cmVhbSBUaGUgc3RyZWFtIHRvIGJlIHB1Ymxpc2hlZC5cbiAgICogQHBhcmFtIHtPd3QuQmFzZS5QdWJsaXNoT3B0aW9uc30gb3B0aW9ucyBPcHRpb25zIGZvciBwdWJsaWNhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdmlkZW9Db2RlY3MgVmlkZW8gY29kZWMgbmFtZXMgZm9yIHB1Ymxpc2hpbmcuIFZhbGlkIHZhbHVlcyBhcmUgJ1ZQOCcsICdWUDknIGFuZCAnSDI2NCcuIFRoaXMgcGFyYW1ldGVyIG9ubHkgdmFsaWQgd2hlbiBvcHRpb25zLnZpZGVvIGlzIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycy4gUHVibGlzaGluZyB3aXRoIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycyBpcyBhbiBleHBlcmltZW50YWwgZmVhdHVyZS4gVGhpcyBwYXJhbWV0ZXIgaXMgc3ViamVjdCB0byBjaGFuZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFB1YmxpY2F0aW9uLCBFcnJvcj59IFJldHVybmVkIHByb21pc2Ugd2lsbCBiZSByZXNvbHZlZCB3aXRoIGEgbmV3bHkgY3JlYXRlZCBQdWJsaWNhdGlvbiBvbmNlIHNwZWNpZmljIHN0cmVhbSBpcyBzdWNjZXNzZnVsbHkgcHVibGlzaGVkLCBvciByZWplY3RlZCB3aXRoIGEgbmV3bHkgY3JlYXRlZCBFcnJvciBpZiBzdHJlYW0gaXMgaW52YWxpZCBvciBvcHRpb25zIGNhbm5vdCBiZSBzYXRpc2ZpZWQuIFN1Y2Nlc3NmdWxseSBwdWJsaXNoZWQgbWVhbnMgUGVlckNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQgYW5kIHNlcnZlciBpcyBhYmxlIHRvIHByb2Nlc3MgbWVkaWEgZGF0YS5cbiAgICovXG4gIHRoaXMucHVibGlzaCA9IGZ1bmN0aW9uKHN0cmVhbSwgb3B0aW9ucywgdmlkZW9Db2RlY3MpIHtcbiAgICBpZiAoIShzdHJlYW0gaW5zdGFuY2VvZiBTdHJlYW1Nb2R1bGUuTG9jYWxTdHJlYW0pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcignSW52YWxpZCBzdHJlYW0uJykpO1xuICAgIH1cbiAgICBpZiAocHVibGlzaENoYW5uZWxzLmhhcyhzdHJlYW0ubWVkaWFTdHJlYW0uaWQpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcihcbiAgICAgICAgICAnQ2Fubm90IHB1Ymxpc2ggYSBwdWJsaXNoZWQgc3RyZWFtLicpKTtcbiAgICB9XG4gICAgY29uc3QgY2hhbm5lbCA9IGNyZWF0ZVBlZXJDb25uZWN0aW9uQ2hhbm5lbCgpO1xuICAgIHJldHVybiBjaGFubmVsLnB1Ymxpc2goc3RyZWFtLCBvcHRpb25zLCB2aWRlb0NvZGVjcyk7XG4gIH07XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBzdWJzY3JpYmVcbiAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkNvbmZlcmVuY2VDbGllbnRcbiAgICogQGluc3RhbmNlXG4gICAqIEBkZXNjIFN1YnNjcmliZSBhIFJlbW90ZVN0cmVhbSBmcm9tIGNvbmZlcmVuY2Ugc2VydmVyLlxuICAgKiBAcGFyYW0ge093dC5CYXNlLlJlbW90ZVN0cmVhbX0gc3RyZWFtIFRoZSBzdHJlYW0gdG8gYmUgc3Vic2NyaWJlZC5cbiAgICogQHBhcmFtIHtPd3QuQ29uZmVyZW5jZS5TdWJzY3JpYmVPcHRpb25zfSBvcHRpb25zIE9wdGlvbnMgZm9yIHN1YnNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3Vic2NyaXB0aW9uLCBFcnJvcj59IFJldHVybmVkIHByb21pc2Ugd2lsbCBiZSByZXNvbHZlZCB3aXRoIGEgbmV3bHkgY3JlYXRlZCBTdWJzY3JpcHRpb24gb25jZSBzcGVjaWZpYyBzdHJlYW0gaXMgc3VjY2Vzc2Z1bGx5IHN1YnNjcmliZWQsIG9yIHJlamVjdGVkIHdpdGggYSBuZXdseSBjcmVhdGVkIEVycm9yIGlmIHN0cmVhbSBpcyBpbnZhbGlkIG9yIG9wdGlvbnMgY2Fubm90IGJlIHNhdGlzZmllZC4gU3VjY2Vzc2Z1bGx5IHN1YnNjcmliZWQgbWVhbnMgUGVlckNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQgYW5kIHNlcnZlciB3YXMgc3RhcnRlZCB0byBzZW5kIG1lZGlhIGRhdGEuXG4gICAqL1xuICB0aGlzLnN1YnNjcmliZSA9IGZ1bmN0aW9uKHN0cmVhbSwgb3B0aW9ucykge1xuICAgIGlmICghKHN0cmVhbSBpbnN0YW5jZW9mIFN0cmVhbU1vZHVsZS5SZW1vdGVTdHJlYW0pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcignSW52YWxpZCBzdHJlYW0uJykpO1xuICAgIH1cbiAgICBjb25zdCBjaGFubmVsID0gY3JlYXRlUGVlckNvbm5lY3Rpb25DaGFubmVsKCk7XG4gICAgcmV0dXJuIGNoYW5uZWwuc3Vic2NyaWJlKHN0cmVhbSwgb3B0aW9ucyk7XG4gIH07XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBzZW5kXG4gICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5Db25mZXJlbmNlQ2xpZW50XG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBTZW5kIGEgdGV4dCBtZXNzYWdlIHRvIGEgcGFydGljaXBhbnQgb3IgYWxsIHBhcnRpY2lwYW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgTWVzc2FnZSB0byBiZSBzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGFydGljaXBhbnRJZCBSZWNlaXZlciBvZiB0aGlzIG1lc3NhZ2UuIE1lc3NhZ2Ugd2lsbCBiZSBzZW50IHRvIGFsbCBwYXJ0aWNpcGFudHMgaWYgcGFydGljaXBhbnRJZCBpcyB1bmRlZmluZWQuXG4gICAqIEByZXR1cm4ge1Byb21pc2U8dm9pZCwgRXJyb3I+fSBSZXR1cm5lZCBwcm9taXNlIHdpbGwgYmUgcmVzb2x2ZWQgd2hlbiBjb25mZXJlbmNlIHNlcnZlciByZWNlaXZlZCBjZXJ0YWluIG1lc3NhZ2UuXG4gICAqL1xuICB0aGlzLnNlbmQgPSBmdW5jdGlvbihtZXNzYWdlLCBwYXJ0aWNpcGFudElkKSB7XG4gICAgaWYgKHBhcnRpY2lwYW50SWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGFydGljaXBhbnRJZCA9ICdhbGwnO1xuICAgIH1cbiAgICByZXR1cm4gc2VuZFNpZ25hbGluZ01lc3NhZ2UoJ3RleHQnLCB7dG86IHBhcnRpY2lwYW50SWQsIG1lc3NhZ2U6IG1lc3NhZ2V9KTtcbiAgfTtcblxuICAvKipcbiAgICogQGZ1bmN0aW9uIGxlYXZlXG4gICAqIEBtZW1iZXJPZiBPd3QuQ29uZmVyZW5jZS5Db25mZXJlbmNlQ2xpZW50XG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBMZWF2ZSBhIGNvbmZlcmVuY2UuXG4gICAqIEByZXR1cm4ge1Byb21pc2U8dm9pZCwgRXJyb3I+fSBSZXR1cm5lZCBwcm9taXNlIHdpbGwgYmUgcmVzb2x2ZWQgd2l0aCB1bmRlZmluZWQgb25jZSB0aGUgY29ubmVjdGlvbiBpcyBkaXNjb25uZWN0ZWQuXG4gICAqL1xuICB0aGlzLmxlYXZlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHNpZ25hbGluZy5kaXNjb25uZWN0KCkudGhlbigoKSA9PiB7XG4gICAgICBjbGVhbigpO1xuICAgICAgc2lnbmFsaW5nU3RhdGUgPSBTaWduYWxpbmdTdGF0ZS5SRUFEWTtcbiAgICB9KTtcbiAgfTtcbn07XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBAY2xhc3MgQ29uZmVyZW5jZUVycm9yXG4gKiBAY2xhc3NEZXNjIFRoZSBDb25mZXJlbmNlRXJyb3Igb2JqZWN0IHJlcHJlc2VudHMgYW4gZXJyb3IgaW4gY29uZmVyZW5jZSBtb2RlLlxuICogQG1lbWJlck9mIE93dC5Db25mZXJlbmNlXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25mZXJlbmNlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgfVxufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4ndXNlIHN0cmljdCc7XG5cbmV4cG9ydCB7Q29uZmVyZW5jZUNsaWVudH0gZnJvbSAnLi9jbGllbnQuanMnO1xuZXhwb3J0IHtTaW9TaWduYWxpbmd9IGZyb20gJy4vc2lnbmFsaW5nLmpzJztcbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIEBjbGFzcyBDb25mZXJlbmNlSW5mb1xuICogQGNsYXNzRGVzYyBJbmZvcm1hdGlvbiBmb3IgYSBjb25mZXJlbmNlLlxuICogQG1lbWJlck9mIE93dC5Db25mZXJlbmNlXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25mZXJlbmNlSW5mbyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGlkLCBwYXJ0aWNpcGFudHMsIHJlbW90ZVN0cmVhbXMsIG15SW5mbykge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gaWRcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuQ29uZmVyZW5jZUluZm9cbiAgICAgKiBAZGVzYyBDb25mZXJlbmNlIElELlxuICAgICAqL1xuICAgIHRoaXMuaWQgPSBpZDtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtBcnJheTxPd3QuQ29uZmVyZW5jZS5QYXJ0aWNpcGFudD59IHBhcnRpY2lwYW50c1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5Db25mZXJlbmNlSW5mb1xuICAgICAqIEBkZXNjIFBhcnRpY2lwYW50cyBpbiB0aGUgY29uZmVyZW5jZS5cbiAgICAgKi9cbiAgICB0aGlzLnBhcnRpY2lwYW50cyA9IHBhcnRpY2lwYW50cztcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtBcnJheTxPd3QuQmFzZS5SZW1vdGVTdHJlYW0+fSByZW1vdGVTdHJlYW1zXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkNvbmZlcmVuY2VJbmZvXG4gICAgICogQGRlc2MgU3RyZWFtcyBwdWJsaXNoZWQgYnkgcGFydGljaXBhbnRzLiBJdCBhbHNvIGluY2x1ZGVzIHN0cmVhbXMgcHVibGlzaGVkIGJ5IGN1cnJlbnQgdXNlci5cbiAgICAgKi9cbiAgICB0aGlzLnJlbW90ZVN0cmVhbXMgPSByZW1vdGVTdHJlYW1zO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge093dC5CYXNlLlBhcnRpY2lwYW50fSBzZWxmXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkNvbmZlcmVuY2VJbmZvXG4gICAgICovXG4gICAgdGhpcy5zZWxmID0gbXlJbmZvO1xuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbid1c2Ugc3RyaWN0JztcblxuaW1wb3J0ICogYXMgU3RyZWFtTW9kdWxlIGZyb20gJy4uL2Jhc2Uvc3RyZWFtLmpzJztcbmltcG9ydCAqIGFzIFN0cmVhbVV0aWxzTW9kdWxlIGZyb20gJy4vc3RyZWFtdXRpbHMuanMnO1xuaW1wb3J0IHtPd3RFdmVudH0gZnJvbSAnLi4vYmFzZS9ldmVudC5qcyc7XG5cbi8qKlxuICogQGNsYXNzIFJlbW90ZU1peGVkU3RyZWFtXG4gKiBAY2xhc3NEZXNjIE1peGVkIHN0cmVhbSBmcm9tIGNvbmZlcmVuY2Ugc2VydmVyLlxuICogRXZlbnRzOlxuICpcbiAqIHwgRXZlbnQgTmFtZSAgICAgICAgICAgICB8IEFyZ3VtZW50IFR5cGUgICAgfCBGaXJlZCB3aGVuICAgICAgIHxcbiAqIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS18IC0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tIHxcbiAqIHwgYWN0aXZlYXVkaW9pbnB1dGNoYW5nZSB8IEV2ZW50ICAgICAgICAgICAgfCBBdWRpbyBhY3RpdmVuZXNzIG9mIGlucHV0IHN0cmVhbSAob2YgdGhlIG1peGVkIHN0cmVhbSkgaXMgY2hhbmdlZC4gfFxuICogfCBsYXlvdXRjaGFuZ2UgICAgICAgICAgIHwgRXZlbnQgICAgICAgICAgICB8IFZpZGVvJ3MgbGF5b3V0IGhhcyBiZWVuIGNoYW5nZWQuIEl0IHVzdWFsbHkgaGFwcGVucyB3aGVuIGEgbmV3IHZpZGVvIGlzIG1peGVkIGludG8gdGhlIHRhcmdldCBtaXhlZCBzdHJlYW0gb3IgYW4gZXhpc3RpbmcgdmlkZW8gaGFzIGJlZW4gcmVtb3ZlZCBmcm9tIG1peGVkIHN0cmVhbS4gfFxuICpcbiAqIEBtZW1iZXJPZiBPd3QuQ29uZmVyZW5jZVxuICogQGV4dGVuZHMgT3d0LkJhc2UuUmVtb3RlU3RyZWFtXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBSZW1vdGVNaXhlZFN0cmVhbSBleHRlbmRzIFN0cmVhbU1vZHVsZS5SZW1vdGVTdHJlYW0ge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihpbmZvKSB7XG4gICAgaWYgKGluZm8udHlwZSAhPT0gJ21peGVkJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTm90IGEgbWl4ZWQgc3RyZWFtJyk7XG4gICAgfVxuICAgIHN1cGVyKGluZm8uaWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCBuZXcgU3RyZWFtTW9kdWxlLlN0cmVhbVNvdXJjZUluZm8oXG4gICAgICAgICdtaXhlZCcsICdtaXhlZCcpKTtcblxuICAgIHRoaXMuc2V0dGluZ3MgPSBTdHJlYW1VdGlsc01vZHVsZS5jb252ZXJ0VG9QdWJsaWNhdGlvblNldHRpbmdzKGluZm8ubWVkaWEpO1xuXG4gICAgdGhpcy5leHRyYUNhcGFiaWxpdGllcyA9IG5ldyBTdHJlYW1VdGlsc01vZHVsZVxuICAgICAgLmNvbnZlcnRUb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyhcbiAgICAgICAgaW5mby5tZWRpYSk7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgQWN0aXZlQXVkaW9JbnB1dENoYW5nZUV2ZW50XG4gKiBAY2xhc3NEZXNjIENsYXNzIEFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2VFdmVudCByZXByZXNlbnRzIGFuIGFjdGl2ZSBhdWRpbyBpbnB1dCBjaGFuZ2UgZXZlbnQuXG4gKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIEFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2VFdmVudCBleHRlbmRzIE93dEV2ZW50IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IodHlwZSwgaW5pdCkge1xuICAgIHN1cGVyKHR5cGUpO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gYWN0aXZlQXVkaW9JbnB1dFN0cmVhbUlkXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkFjdGl2ZUF1ZGlvSW5wdXRDaGFuZ2VFdmVudFxuICAgICAqIEBkZXNjIFRoZSBJRCBvZiBpbnB1dCBzdHJlYW0ob2YgdGhlIG1peGVkIHN0cmVhbSkgd2hvc2UgYXVkaW8gaXMgYWN0aXZlLlxuICAgICAqL1xuICAgIHRoaXMuYWN0aXZlQXVkaW9JbnB1dFN0cmVhbUlkID0gaW5pdC5hY3RpdmVBdWRpb0lucHV0U3RyZWFtSWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgTGF5b3V0Q2hhbmdlRXZlbnRcbiAqIEBjbGFzc0Rlc2MgQ2xhc3MgTGF5b3V0Q2hhbmdlRXZlbnQgcmVwcmVzZW50cyBhbiB2aWRlbyBsYXlvdXQgY2hhbmdlIGV2ZW50LlxuICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBMYXlvdXRDaGFuZ2VFdmVudCBleHRlbmRzIE93dEV2ZW50IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IodHlwZSwgaW5pdCkge1xuICAgIHN1cGVyKHR5cGUpO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge29iamVjdH0gbGF5b3V0XG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLkxheW91dENoYW5nZUV2ZW50XG4gICAgICogQGRlc2MgQ3VycmVudCB2aWRlbydzIGxheW91dC4gSXQncyBhbiBhcnJheSBvZiBtYXAgd2hpY2ggbWFwcyBlYWNoIHN0cmVhbSB0byBhIHJlZ2lvbi5cbiAgICAgKi9cbiAgICB0aGlzLmxheW91dCA9IGluaXQubGF5b3V0O1xuICB9XG59XG5cbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuaW1wb3J0ICogYXMgRXZlbnRNb2R1bGUgZnJvbSAnLi4vYmFzZS9ldmVudC5qcyc7XG5cbid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBAY2xhc3MgUGFydGljaXBhbnRcbiAqIEBtZW1iZXJPZiBPd3QuQ29uZmVyZW5jZVxuICogQGNsYXNzRGVzYyBUaGUgUGFydGljaXBhbnQgZGVmaW5lcyBhIHBhcnRpY2lwYW50IGluIGEgY29uZmVyZW5jZS5cbiAqIEV2ZW50czpcbiAqXG4gKiB8IEV2ZW50IE5hbWUgICAgICB8IEFyZ3VtZW50IFR5cGUgICAgICB8IEZpcmVkIHdoZW4gICAgICAgfFxuICogfCAtLS0tLS0tLS0tLS0tLS0tfCAtLS0tLS0tLS0tLS0tLS0tLS0gfCAtLS0tLS0tLS0tLS0tLS0tIHxcbiAqIHwgbGVmdCAgICAgICAgICAgIHwgT3d0LkJhc2UuT3d0RXZlbnQgIHwgVGhlIHBhcnRpY2lwYW50IGxlZnQgdGhlIGNvbmZlcmVuY2UuIHxcbiAqXG4gKiBAZXh0ZW5kcyBPd3QuQmFzZS5FdmVudERpc3BhdGNoZXJcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFBhcnRpY2lwYW50IGV4dGVuZHMgRXZlbnRNb2R1bGUuRXZlbnREaXNwYXRjaGVyIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoaWQsIHJvbGUsIHVzZXJJZCkge1xuICAgIHN1cGVyKCk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSBpZFxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5QYXJ0aWNpcGFudFxuICAgICAqIEBkZXNjIFRoZSBJRCBvZiB0aGUgcGFydGljaXBhbnQuIEl0IHZhcmllcyB3aGVuIGEgc2luZ2xlIHVzZXIgam9pbiBkaWZmZXJlbnQgY29uZmVyZW5jZXMuXG4gICAgICovXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdpZCcsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICB2YWx1ZTogaWQsXG4gICAgfSk7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7c3RyaW5nfSByb2xlXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlBhcnRpY2lwYW50XG4gICAgICovXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdyb2xlJywge1xuICAgICAgY29uZmlndXJhYmxlOiBmYWxzZSxcbiAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgIHZhbHVlOiByb2xlLFxuICAgIH0pO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gdXNlcklkXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlBhcnRpY2lwYW50XG4gICAgICogQGRlc2MgVGhlIHVzZXIgSUQgb2YgdGhlIHBhcnRpY2lwYW50LiBJdCBjYW4gYmUgaW50ZWdyYXRlZCBpbnRvIGV4aXN0aW5nIGFjY291bnQgbWFuYWdlbWVudCBzeXN0ZW0uXG4gICAgICovXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICd1c2VySWQnLCB7XG4gICAgICBjb25maWd1cmFibGU6IGZhbHNlLFxuICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgdmFsdWU6IHVzZXJJZCxcbiAgICB9KTtcbiAgfVxufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4vKiBnbG9iYWwgaW8sIFByb21pc2UgKi9cbmltcG9ydCBMb2dnZXIgZnJvbSAnLi4vYmFzZS9sb2dnZXIuanMnO1xuaW1wb3J0ICogYXMgRXZlbnRNb2R1bGUgZnJvbSAnLi4vYmFzZS9ldmVudC5qcyc7XG5pbXBvcnQge0NvbmZlcmVuY2VFcnJvcn0gZnJvbSAnLi9lcnJvci5qcyc7XG5pbXBvcnQge0Jhc2U2NH0gZnJvbSAnLi4vYmFzZS9iYXNlNjQuanMnO1xuXG4ndXNlIHN0cmljdCc7XG5cbmNvbnN0IHJlY29ubmVjdGlvbkF0dGVtcHRzID0gMTA7XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG5mdW5jdGlvbiBoYW5kbGVSZXNwb25zZShzdGF0dXMsIGRhdGEsIHJlc29sdmUsIHJlamVjdCkge1xuICBpZiAoc3RhdHVzID09PSAnb2snIHx8IHN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSB7XG4gICAgcmVzb2x2ZShkYXRhKTtcbiAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICByZWplY3QoZGF0YSk7XG4gIH0gZWxzZSB7XG4gICAgTG9nZ2VyLmVycm9yKCdNQ1UgcmV0dXJucyB1bmtub3duIGFjay4nKTtcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBTaW9TaWduYWxpbmdcbiAqIEBjbGFzc2Rlc2MgU29ja2V0LklPIHNpZ25hbGluZyBjaGFubmVsIGZvciBDb25mZXJlbmNlQ2xpZW50LiBJdCBpcyBub3QgcmVjb21tZW5kZWQgdG8gZGlyZWN0bHkgYWNjZXNzIHRoaXMgY2xhc3MuXG4gKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBleHRlbmRzIE93dC5CYXNlLkV2ZW50RGlzcGF0Y2hlclxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBTaW9TaWduYWxpbmcgZXh0ZW5kcyBFdmVudE1vZHVsZS5FdmVudERpc3BhdGNoZXIge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuX3NvY2tldCA9IG51bGw7XG4gICAgdGhpcy5fbG9nZ2VkSW4gPSBmYWxzZTtcbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lcyA9IDA7XG4gICAgdGhpcy5fcmVjb25uZWN0aW9uVGlja2V0ID0gbnVsbDtcbiAgICB0aGlzLl9yZWZyZXNoUmVjb25uZWN0aW9uVGlja2V0ID0gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gY29ubmVjdFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgQ29ubmVjdCB0byBhIHBvcnRhbC5cbiAgICogQG1lbWJlcm9mIE9tcy5Db25mZXJlbmNlLlNpb1NpZ25hbGluZ1xuICAgKiBAcmV0dXJuIHtQcm9taXNlPE9iamVjdCwgRXJyb3I+fSBSZXR1cm4gYSBwcm9taXNlIHJlc29sdmVkIHdpdGggdGhlIGRhdGEgcmV0dXJuZWQgYnkgcG9ydGFsIGlmIHN1Y2Nlc3NmdWxseSBsb2dnZWQgaW4uIE9yIHJldHVybiBhIHByb21pc2UgcmVqZWN0ZWQgd2l0aCBhIG5ld2x5IGNyZWF0ZWQgT21zLkVycm9yIGlmIGZhaWxlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGhvc3QgSG9zdCBvZiB0aGUgcG9ydGFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaXNTZWN1cmVkIElzIHNlY3VyZSBjb25uZWN0aW9uIG9yIG5vdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvZ2luSW5mbyBJbmZvbWF0aW9uIHJlcXVpcmVkIGZvciBsb2dnaW5nIGluLlxuICAgKiBAcHJpdmF0ZS5cbiAgICovXG4gIGNvbm5lY3QoaG9zdCwgaXNTZWN1cmVkLCBsb2dpbkluZm8pIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgb3B0cyA9IHtcbiAgICAgICAgJ3JlY29ubmVjdGlvbic6IHRydWUsXG4gICAgICAgICdyZWNvbm5lY3Rpb25BdHRlbXB0cyc6IHJlY29ubmVjdGlvbkF0dGVtcHRzLFxuICAgICAgICAnZm9yY2UgbmV3IGNvbm5lY3Rpb24nOiB0cnVlLFxuICAgICAgfTtcbiAgICAgIHRoaXMuX3NvY2tldCA9IGlvKGhvc3QsIG9wdHMpO1xuICAgICAgWydwYXJ0aWNpcGFudCcsICd0ZXh0JywgJ3N0cmVhbScsICdwcm9ncmVzcyddLmZvckVhY2goKFxuICAgICAgICAgIG5vdGlmaWNhdGlvbikgPT4ge1xuICAgICAgICB0aGlzLl9zb2NrZXQub24obm90aWZpY2F0aW9uLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnRNb2R1bGUuTWVzc2FnZUV2ZW50KCdkYXRhJywge1xuICAgICAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgICAgICBub3RpZmljYXRpb246IG5vdGlmaWNhdGlvbixcbiAgICAgICAgICAgICAgZGF0YTogZGF0YSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5fc29ja2V0Lm9uKCdyZWNvbm5lY3RpbmcnLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVzKys7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuX3NvY2tldC5vbigncmVjb25uZWN0X2ZhaWxlZCcsICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVzID49IHJlY29ubmVjdGlvbkF0dGVtcHRzKSB7XG4gICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudE1vZHVsZS5Pd3RFdmVudCgnZGlzY29ubmVjdCcpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLl9zb2NrZXQub24oJ2Nvbm5lY3RfZXJyb3InLCAoZSkgPT4ge1xuICAgICAgICByZWplY3QoYGNvbm5lY3RfZXJyb3I6JHtob3N0fWApO1xuICAgICAgfSk7XG4gICAgICB0aGlzLl9zb2NrZXQub24oJ2Ryb3AnLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVzID0gcmVjb25uZWN0aW9uQXR0ZW1wdHM7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuX3NvY2tldC5vbignZGlzY29ubmVjdCcsICgpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJSZWNvbm5lY3Rpb25UYXNrKCk7XG4gICAgICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcyA+PSByZWNvbm5lY3Rpb25BdHRlbXB0cykge1xuICAgICAgICAgIHRoaXMuX2xvZ2dlZEluID0gZmFsc2U7XG4gICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudE1vZHVsZS5Pd3RFdmVudCgnZGlzY29ubmVjdCcpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLl9zb2NrZXQuZW1pdCgnbG9naW4nLCBsb2dpbkluZm8sIChzdGF0dXMsIGRhdGEpID0+IHtcbiAgICAgICAgaWYgKHN0YXR1cyA9PT0gJ29rJykge1xuICAgICAgICAgIHRoaXMuX2xvZ2dlZEluID0gdHJ1ZTtcbiAgICAgICAgICB0aGlzLl9vblJlY29ubmVjdGlvblRpY2tldChkYXRhLnJlY29ubmVjdGlvblRpY2tldCk7XG4gICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKCdjb25uZWN0JywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gcmUtbG9naW4gd2l0aCByZWNvbm5lY3Rpb24gdGlja2V0LlxuICAgICAgICAgICAgdGhpcy5fc29ja2V0LmVtaXQoJ3JlbG9naW4nLCB0aGlzLl9yZWNvbm5lY3Rpb25UaWNrZXQsIChzdGF0dXMsXG4gICAgICAgICAgICAgICAgZGF0YSkgPT4ge1xuICAgICAgICAgICAgICBpZiAoc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXMgPSAwO1xuICAgICAgICAgICAgICAgIHRoaXMuX29uUmVjb25uZWN0aW9uVGlja2V0KGRhdGEpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnRNb2R1bGUuT3d0RXZlbnQoJ2Rpc2Nvbm5lY3QnKSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGhhbmRsZVJlc3BvbnNlKHN0YXR1cywgZGF0YSwgcmVzb2x2ZSwgcmVqZWN0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBkaXNjb25uZWN0XG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBEaXNjb25uZWN0IGZyb20gYSBwb3J0YWwuXG4gICAqIEBtZW1iZXJvZiBPbXMuQ29uZmVyZW5jZS5TaW9TaWduYWxpbmdcbiAgICogQHJldHVybiB7UHJvbWlzZTxPYmplY3QsIEVycm9yPn0gUmV0dXJuIGEgcHJvbWlzZSByZXNvbHZlZCB3aXRoIHRoZSBkYXRhIHJldHVybmVkIGJ5IHBvcnRhbCBpZiBzdWNjZXNzZnVsbHkgZGlzY29ubmVjdGVkLiBPciByZXR1cm4gYSBwcm9taXNlIHJlamVjdGVkIHdpdGggYSBuZXdseSBjcmVhdGVkIE9tcy5FcnJvciBpZiBmYWlsZWQuXG4gICAqIEBwcml2YXRlLlxuICAgKi9cbiAgZGlzY29ubmVjdCgpIHtcbiAgICBpZiAoIXRoaXMuX3NvY2tldCB8fCB0aGlzLl9zb2NrZXQuZGlzY29ubmVjdGVkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IENvbmZlcmVuY2VFcnJvcihcbiAgICAgICAgICAnUG9ydGFsIGlzIG5vdCBjb25uZWN0ZWQuJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fc29ja2V0LmVtaXQoJ2xvZ291dCcsIChzdGF0dXMsIGRhdGEpID0+IHtcbiAgICAgICAgLy8gTWF4aW1pemUgdGhlIHJlY29ubmVjdCB0aW1lcyB0byBkaXNhYmxlIHJlY29ubmVjdGlvbi5cbiAgICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXMgPSByZWNvbm5lY3Rpb25BdHRlbXB0cztcbiAgICAgICAgdGhpcy5fc29ja2V0LmRpc2Nvbm5lY3QoKTtcbiAgICAgICAgaGFuZGxlUmVzcG9uc2Uoc3RhdHVzLCBkYXRhLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIHNlbmRcbiAgICogQGluc3RhbmNlXG4gICAqIEBkZXNjIFNlbmQgZGF0YSB0byBwb3J0YWwuXG4gICAqIEBtZW1iZXJvZiBPbXMuQ29uZmVyZW5jZS5TaW9TaWduYWxpbmdcbiAgICogQHJldHVybiB7UHJvbWlzZTxPYmplY3QsIEVycm9yPn0gUmV0dXJuIGEgcHJvbWlzZSByZXNvbHZlZCB3aXRoIHRoZSBkYXRhIHJldHVybmVkIGJ5IHBvcnRhbC4gT3IgcmV0dXJuIGEgcHJvbWlzZSByZWplY3RlZCB3aXRoIGEgbmV3bHkgY3JlYXRlZCBPbXMuRXJyb3IgaWYgZmFpbGVkIHRvIHNlbmQgdGhlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXF1ZXN0TmFtZSBOYW1lIGRlZmluZWQgaW4gY2xpZW50LXNlcnZlciBwcm90b2NvbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlcXVlc3REYXRhIERhdGEgZm9ybWF0IGlzIGRlZmluZWQgaW4gY2xpZW50LXNlcnZlciBwcm90b2NvbC5cbiAgICogQHByaXZhdGUuXG4gICAqL1xuICBzZW5kKHJlcXVlc3ROYW1lLCByZXF1ZXN0RGF0YSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9zb2NrZXQuZW1pdChyZXF1ZXN0TmFtZSwgcmVxdWVzdERhdGEsIChzdGF0dXMsIGRhdGEpID0+IHtcbiAgICAgICAgaGFuZGxlUmVzcG9uc2Uoc3RhdHVzLCBkYXRhLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF9vblJlY29ubmVjdGlvblRpY2tldFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgUGFyc2UgcmVjb25uZWN0aW9uIHRpY2tldCBhbmQgc2NoZWR1bGUgdGlja2V0IHJlZnJlc2hpbmcuXG4gICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TaW9TaWduYWxpbmdcbiAgICogQHByaXZhdGUuXG4gICAqL1xuICBfb25SZWNvbm5lY3Rpb25UaWNrZXQodGlja2V0U3RyaW5nKSB7XG4gICAgdGhpcy5fcmVjb25uZWN0aW9uVGlja2V0ID0gdGlja2V0U3RyaW5nO1xuICAgIGNvbnN0IHRpY2tldCA9IEpTT04ucGFyc2UoQmFzZTY0LmRlY29kZUJhc2U2NCh0aWNrZXRTdHJpbmcpKTtcbiAgICAvLyBSZWZyZXNoIHRpY2tldCAxIG1pbiBvciAxMCBzZWNvbmRzIGJlZm9yZSBpdCBleHBpcmVzLlxuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgY29uc3QgbWlsbGlzZWNvbmRzSW5PbmVNaW51dGUgPSA2MCAqIDEwMDA7XG4gICAgY29uc3QgbWlsbGlzZWNvbmRzSW5UZW5TZWNvbmRzID0gMTAgKiAxMDAwO1xuICAgIGlmICh0aWNrZXQubm90QWZ0ZXIgPD0gbm93IC0gbWlsbGlzZWNvbmRzSW5UZW5TZWNvbmRzKSB7XG4gICAgICBMb2dnZXIud2FybmluZygnUmVjb25uZWN0aW9uIHRpY2tldCBleHBpcmVzIHRvbyBzb29uLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBsZXQgcmVmcmVzaEFmdGVyID0gdGlja2V0Lm5vdEFmdGVyIC0gbm93IC0gbWlsbGlzZWNvbmRzSW5PbmVNaW51dGU7XG4gICAgaWYgKHJlZnJlc2hBZnRlciA8IDApIHtcbiAgICAgIHJlZnJlc2hBZnRlciA9IHRpY2tldC5ub3RBZnRlciAtIG5vdyAtIG1pbGxpc2Vjb25kc0luVGVuU2Vjb25kcztcbiAgICB9XG4gICAgdGhpcy5fY2xlYXJSZWNvbm5lY3Rpb25UYXNrKCk7XG4gICAgdGhpcy5fcmVmcmVzaFJlY29ubmVjdGlvblRpY2tldCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc29ja2V0LmVtaXQoJ3JlZnJlc2hSZWNvbm5lY3Rpb25UaWNrZXQnLCAoc3RhdHVzLCBkYXRhKSA9PiB7XG4gICAgICAgIGlmIChzdGF0dXMgIT09ICdvaycpIHtcbiAgICAgICAgICBMb2dnZXIud2FybmluZygnRmFpbGVkIHRvIHJlZnJlc2ggcmVjb25uZWN0aW9uIHRpY2tldC4nKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fb25SZWNvbm5lY3Rpb25UaWNrZXQoZGF0YSk7XG4gICAgICB9KTtcbiAgICB9LCByZWZyZXNoQWZ0ZXIpO1xuICB9XG5cbiAgX2NsZWFyUmVjb25uZWN0aW9uVGFzaygpIHtcbiAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVmcmVzaFJlY29ubmVjdGlvblRpY2tldCk7XG4gICAgdGhpcy5fcmVmcmVzaFJlY29ubmVjdGlvblRpY2tldCA9IG51bGw7XG4gIH1cbn1cbiIsIi8vIENvcHlyaWdodCAoQykgPDIwMTg+IEludGVsIENvcnBvcmF0aW9uXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuLy8gVGhpcyBmaWxlIGRvZXNuJ3QgaGF2ZSBwdWJsaWMgQVBJcy5cbi8qIGVzbGludC1kaXNhYmxlIHZhbGlkLWpzZG9jICovXG5cbid1c2Ugc3RyaWN0JztcblxuaW1wb3J0ICogYXMgUHVibGljYXRpb25Nb2R1bGUgZnJvbSAnLi4vYmFzZS9wdWJsaWNhdGlvbi5qcyc7XG5pbXBvcnQgKiBhcyBNZWRpYUZvcm1hdE1vZHVsZSBmcm9tICcuLi9iYXNlL21lZGlhZm9ybWF0LmpzJztcbmltcG9ydCAqIGFzIENvZGVjTW9kdWxlIGZyb20gJy4uL2Jhc2UvY29kZWMuanMnO1xuaW1wb3J0ICogYXMgU3Vic2NyaXB0aW9uTW9kdWxlIGZyb20gJy4vc3Vic2NyaXB0aW9uLmpzJztcblxuXG4vKipcbiAqIEBmdW5jdGlvbiBleHRyYWN0Qml0cmF0ZU11bHRpcGxpZXJcbiAqIEBkZXNjIEV4dHJhY3QgYml0cmF0ZSBtdWx0aXBsaWVyIGZyb20gYSBzdHJpbmcgbGlrZSBcIngwLjJcIi5cbiAqIEByZXR1cm4ge1Byb21pc2U8T2JqZWN0LCBFcnJvcj59IFRoZSBmbG9hdCBudW1iZXIgYWZ0ZXIgXCJ4XCIuXG4gKiBAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBleHRyYWN0Qml0cmF0ZU11bHRpcGxpZXIoaW5wdXQpIHtcbiAgaWYgKHR5cGVvZiBpbnB1dCAhPT0gJ3N0cmluZycgfHwgIWlucHV0LnN0YXJ0c1dpdGgoJ3gnKSkge1xuICAgIEwuTG9nZ2VyLndhcm5pbmcoJ0ludmFsaWQgYml0cmF0ZSBtdWx0aXBsaWVyIGlucHV0LicpO1xuICAgIHJldHVybiAwO1xuICB9XG4gIHJldHVybiBOdW1iZXIucGFyc2VGbG9hdChpbnB1dC5yZXBsYWNlKC9eeC8sICcnKSk7XG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG5mdW5jdGlvbiBzb3J0TnVtYmVycyh4LCB5KSB7XG4gIHJldHVybiB4IC0geTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbmZ1bmN0aW9uIHNvcnRSZXNvbHV0aW9ucyh4LCB5KSB7XG4gIGlmICh4LndpZHRoICE9PSB5LndpZHRoKSB7XG4gICAgcmV0dXJuIHgud2lkdGggLSB5LndpZHRoO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB4LmhlaWdodCAtIHkuaGVpZ2h0O1xuICB9XG59XG5cbi8qKlxuICogQGZ1bmN0aW9uIGNvbnZlcnRUb1B1YmxpY2F0aW9uU2V0dGluZ3NcbiAqIEBkZXNjIENvbnZlcnQgbWVkaWFJbmZvIHJlY2VpdmVkIGZyb20gc2VydmVyIHRvIFB1YmxpY2F0aW9uU2V0dGluZ3MuXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvUHVibGljYXRpb25TZXR0aW5ncyhtZWRpYUluZm8pIHtcbiAgbGV0IGF1ZGlvID0gW10sXG4gICAgdmlkZW8gPSBbXTtcbiAgbGV0IGF1ZGlvQ29kZWMsIHZpZGVvQ29kZWMsIHJlc29sdXRpb24sIGZyYW1lcmF0ZSwgYml0cmF0ZSwga2V5RnJhbWVJbnRlcnZhbCxcbiAgICByaWQ7XG4gIGlmIChtZWRpYUluZm8uYXVkaW8pIHtcbiAgICBpZiAobWVkaWFJbmZvLmF1ZGlvLmZvcm1hdCkge1xuICAgICAgYXVkaW9Db2RlYyA9IG5ldyBDb2RlY01vZHVsZS5BdWRpb0NvZGVjUGFyYW1ldGVycyhcbiAgICAgICAgbWVkaWFJbmZvLmF1ZGlvLmZvcm1hdC5jb2RlYywgbWVkaWFJbmZvLmF1ZGlvLmZvcm1hdC5jaGFubmVsTnVtLFxuICAgICAgICBtZWRpYUluZm8uYXVkaW8uZm9ybWF0LnNhbXBsZVJhdGUpO1xuICAgIH1cbiAgICBhdWRpby5wdXNoKG5ldyBQdWJsaWNhdGlvbk1vZHVsZS5BdWRpb1B1YmxpY2F0aW9uU2V0dGluZ3MoYXVkaW9Db2RlYykpO1xuICB9XG4gIGlmIChtZWRpYUluZm8udmlkZW8pIHtcbiAgICBmb3IgKGNvbnN0IHZpZGVvSW5mbyBvZiBtZWRpYUluZm8udmlkZW8ub3JpZ2luYWwpIHtcbiAgICAgIGlmICh2aWRlb0luZm8uZm9ybWF0KSB7XG4gICAgICAgIHZpZGVvQ29kZWMgPSBuZXcgQ29kZWNNb2R1bGUuVmlkZW9Db2RlY1BhcmFtZXRlcnMoXG4gICAgICAgICAgdmlkZW9JbmZvLmZvcm1hdC5jb2RlYywgdmlkZW9JbmZvLmZvcm1hdC5wcm9maWxlKTtcbiAgICAgIH1cbiAgICAgIGlmICh2aWRlb0luZm8ucGFyYW1ldGVycykge1xuICAgICAgICBpZiAodmlkZW9JbmZvLnBhcmFtZXRlcnMucmVzb2x1dGlvbikge1xuICAgICAgICAgIHJlc29sdXRpb24gPSBuZXcgTWVkaWFGb3JtYXRNb2R1bGUuUmVzb2x1dGlvbihcbiAgICAgICAgICAgIHZpZGVvSW5mby5wYXJhbWV0ZXJzLnJlc29sdXRpb24ud2lkdGgsXG4gICAgICAgICAgICB2aWRlb0luZm8ucGFyYW1ldGVycy5yZXNvbHV0aW9uLmhlaWdodCk7XG4gICAgICAgIH1cbiAgICAgICAgZnJhbWVyYXRlID0gdmlkZW9JbmZvLnBhcmFtZXRlcnMuZnJhbWVyYXRlO1xuICAgICAgICBiaXRyYXRlID0gdmlkZW9JbmZvLnBhcmFtZXRlcnMuYml0cmF0ZSAqIDEwMDA7XG4gICAgICAgIGtleUZyYW1lSW50ZXJ2YWwgPSB2aWRlb0luZm8ucGFyYW1ldGVycy5rZXlGcmFtZUludGVydmFsO1xuICAgICAgfVxuICAgICAgaWYgKHZpZGVvSW5mby5zaW11bGNhc3RSaWQpIHtcbiAgICAgICAgcmlkID0gdmlkZW9JbmZvLnNpbXVsY2FzdFJpZDtcbiAgICAgIH1cbiAgICAgIHZpZGVvLnB1c2gobmV3IFB1YmxpY2F0aW9uTW9kdWxlLlZpZGVvUHVibGljYXRpb25TZXR0aW5ncyhcbiAgICAgICAgdmlkZW9Db2RlYywgcmVzb2x1dGlvbiwgZnJhbWVyYXRlLCBiaXRyYXRlLCBrZXlGcmFtZUludGVydmFsLCByaWQpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBQdWJsaWNhdGlvbk1vZHVsZS5QdWJsaWNhdGlvblNldHRpbmdzKGF1ZGlvLCB2aWRlbyk7XG59XG5cbi8qKlxuICogQGZ1bmN0aW9uIGNvbnZlcnRUb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllc1xuICogQGRlc2MgQ29udmVydCBtZWRpYUluZm8gcmVjZWl2ZWQgZnJvbSBzZXJ2ZXIgdG8gU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzLlxuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyhtZWRpYUluZm8pIHtcbiAgbGV0IGF1ZGlvOyBsZXQgdmlkZW87XG4gIGlmIChtZWRpYUluZm8uYXVkaW8pIHtcbiAgICBjb25zdCBhdWRpb0NvZGVjcyA9IFtdO1xuICAgIGlmIChtZWRpYUluZm8uYXVkaW8gJiYgbWVkaWFJbmZvLmF1ZGlvLm9wdGlvbmFsICYmXG4gICAgICBtZWRpYUluZm8uYXVkaW8ub3B0aW9uYWwuZm9ybWF0KSB7XG4gICAgICBmb3IgKGNvbnN0IGF1ZGlvQ29kZWNJbmZvIG9mIG1lZGlhSW5mby5hdWRpby5vcHRpb25hbC5mb3JtYXQpIHtcbiAgICAgICAgY29uc3QgYXVkaW9Db2RlYyA9IG5ldyBDb2RlY01vZHVsZS5BdWRpb0NvZGVjUGFyYW1ldGVycyhcbiAgICAgICAgICAgIGF1ZGlvQ29kZWNJbmZvLmNvZGVjLCBhdWRpb0NvZGVjSW5mby5jaGFubmVsTnVtLFxuICAgICAgICAgICAgYXVkaW9Db2RlY0luZm8uc2FtcGxlUmF0ZSk7XG4gICAgICAgIGF1ZGlvQ29kZWNzLnB1c2goYXVkaW9Db2RlYyk7XG4gICAgICB9XG4gICAgfVxuICAgIGF1ZGlvQ29kZWNzLnNvcnQoKTtcbiAgICBhdWRpbyA9IG5ldyBTdWJzY3JpcHRpb25Nb2R1bGUuQXVkaW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXMoYXVkaW9Db2RlY3MpO1xuICB9XG4gIGlmIChtZWRpYUluZm8udmlkZW8pIHtcbiAgICBjb25zdCB2aWRlb0NvZGVjcyA9IFtdO1xuICAgIGlmIChtZWRpYUluZm8udmlkZW8gJiYgbWVkaWFJbmZvLnZpZGVvLm9wdGlvbmFsICYmXG4gICAgICBtZWRpYUluZm8udmlkZW8ub3B0aW9uYWwuZm9ybWF0KSB7XG4gICAgICBmb3IgKGNvbnN0IHZpZGVvQ29kZWNJbmZvIG9mIG1lZGlhSW5mby52aWRlby5vcHRpb25hbC5mb3JtYXQpIHtcbiAgICAgICAgY29uc3QgdmlkZW9Db2RlYyA9IG5ldyBDb2RlY01vZHVsZS5WaWRlb0NvZGVjUGFyYW1ldGVycyhcbiAgICAgICAgICAgIHZpZGVvQ29kZWNJbmZvLmNvZGVjLCB2aWRlb0NvZGVjSW5mby5wcm9maWxlKTtcbiAgICAgICAgdmlkZW9Db2RlY3MucHVzaCh2aWRlb0NvZGVjKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdmlkZW9Db2RlY3Muc29ydCgpO1xuICAgIGlmIChtZWRpYUluZm8udmlkZW8gJiYgbWVkaWFJbmZvLnZpZGVvLm9wdGlvbmFsICYmIG1lZGlhSW5mby52aWRlby5vcHRpb25hbFxuICAgICAgLnBhcmFtZXRlcnMpIHtcbiAgICAgIGNvbnN0IHJlc29sdXRpb25zID0gQXJyYXkuZnJvbShcbiAgICAgICAgbWVkaWFJbmZvLnZpZGVvLm9wdGlvbmFsLnBhcmFtZXRlcnMucmVzb2x1dGlvbixcbiAgICAgICAgKHIpID0+IG5ldyBNZWRpYUZvcm1hdE1vZHVsZS5SZXNvbHV0aW9uKHIud2lkdGgsIHIuaGVpZ2h0KSk7XG4gICAgICByZXNvbHV0aW9ucy5zb3J0KHNvcnRSZXNvbHV0aW9ucyk7XG4gICAgICBjb25zdCBiaXRyYXRlcyA9IEFycmF5LmZyb20oXG4gICAgICAgIG1lZGlhSW5mby52aWRlby5vcHRpb25hbC5wYXJhbWV0ZXJzLmJpdHJhdGUsXG4gICAgICAgIChiaXRyYXRlKSA9PiBleHRyYWN0Qml0cmF0ZU11bHRpcGxpZXIoYml0cmF0ZSkpO1xuICAgICAgYml0cmF0ZXMucHVzaCgxLjApO1xuICAgICAgYml0cmF0ZXMuc29ydChzb3J0TnVtYmVycyk7XG4gICAgICBjb25zdCBmcmFtZVJhdGVzID0gSlNPTi5wYXJzZShcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkobWVkaWFJbmZvLnZpZGVvLm9wdGlvbmFsLnBhcmFtZXRlcnMuZnJhbWVyYXRlKSk7XG4gICAgICBmcmFtZVJhdGVzLnNvcnQoc29ydE51bWJlcnMpO1xuICAgICAgY29uc3Qga2V5RnJhbWVJbnRlcnZhbHMgPSBKU09OLnBhcnNlKFxuICAgICAgICBKU09OLnN0cmluZ2lmeShtZWRpYUluZm8udmlkZW8ub3B0aW9uYWwucGFyYW1ldGVycy5rZXlGcmFtZUludGVydmFsKSk7XG4gICAgICBrZXlGcmFtZUludGVydmFscy5zb3J0KHNvcnROdW1iZXJzKTtcbiAgICAgIHZpZGVvID0gbmV3IFN1YnNjcmlwdGlvbk1vZHVsZS5WaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyhcbiAgICAgICAgdmlkZW9Db2RlY3MsIHJlc29sdXRpb25zLCBmcmFtZVJhdGVzLCBiaXRyYXRlcywga2V5RnJhbWVJbnRlcnZhbHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2aWRlbyA9IG5ldyBTdWJzY3JpcHRpb25Nb2R1bGUuVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXModmlkZW9Db2RlY3MsXG4gICAgICAgIFtdLCBbXSwgWzEuMF0sIFtdKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBTdWJzY3JpcHRpb25Nb2R1bGUuU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzKGF1ZGlvLCB2aWRlbyk7XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbid1c2Ugc3RyaWN0JztcblxuaW1wb3J0ICogYXMgTWVkaWFGb3JtYXRNb2R1bGUgZnJvbSAnLi4vYmFzZS9tZWRpYWZvcm1hdC5qcyc7XG5pbXBvcnQgKiBhcyBDb2RlY01vZHVsZSBmcm9tICcuLi9iYXNlL2NvZGVjLmpzJztcbmltcG9ydCB7RXZlbnREaXNwYXRjaGVyfSBmcm9tICcuLi9iYXNlL2V2ZW50LmpzJztcblxuLyoqXG4gKiBAY2xhc3MgQXVkaW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAqIEBtZW1iZXJPZiBPd3QuQ29uZmVyZW5jZVxuICogQGNsYXNzRGVzYyBSZXByZXNlbnRzIHRoZSBhdWRpbyBjYXBhYmlsaXR5IGZvciBzdWJzY3JpcHRpb24uXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBBdWRpb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGNvZGVjcykge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge0FycmF5LjxPd3QuQmFzZS5BdWRpb0NvZGVjUGFyYW1ldGVycz59IGNvZGVjc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5BdWRpb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllc1xuICAgICAqL1xuICAgIHRoaXMuY29kZWNzID0gY29kZWNzO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIFZpZGVvU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzXG4gKiBAbWVtYmVyT2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBjbGFzc0Rlc2MgUmVwcmVzZW50cyB0aGUgdmlkZW8gY2FwYWJpbGl0eSBmb3Igc3Vic2NyaXB0aW9uLlxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXMge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcihjb2RlY3MsIHJlc29sdXRpb25zLCBmcmFtZVJhdGVzLCBiaXRyYXRlTXVsdGlwbGllcnMsXG4gICAgICBrZXlGcmFtZUludGVydmFscykge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge0FycmF5LjxPd3QuQmFzZS5WaWRlb0NvZGVjUGFyYW1ldGVycz59IGNvZGVjc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllc1xuICAgICAqL1xuICAgIHRoaXMuY29kZWNzID0gY29kZWNzO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge0FycmF5LjxPd3QuQmFzZS5SZXNvbHV0aW9uPn0gcmVzb2x1dGlvbnNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLnJlc29sdXRpb25zID0gcmVzb2x1dGlvbnM7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7QXJyYXkuPG51bWJlcj59IGZyYW1lUmF0ZXNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLmZyYW1lUmF0ZXMgPSBmcmFtZVJhdGVzO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge0FycmF5LjxudW1iZXI+fSBiaXRyYXRlTXVsdGlwbGllcnNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLmJpdHJhdGVNdWx0aXBsaWVycyA9IGJpdHJhdGVNdWx0aXBsaWVycztcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHtBcnJheS48bnVtYmVyPn0ga2V5RnJhbWVJbnRlcnZhbHNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLmtleUZyYW1lSW50ZXJ2YWxzID0ga2V5RnJhbWVJbnRlcnZhbHM7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzXG4gKiBAbWVtYmVyT2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBjbGFzc0Rlc2MgUmVwcmVzZW50cyB0aGUgY2FwYWJpbGl0eSBmb3Igc3Vic2NyaXB0aW9uLlxuICogQGhpZGVjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgY2xhc3MgU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoYXVkaW8sIHZpZGVvKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P093dC5Db25mZXJlbmNlLkF1ZGlvU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzfSBhdWRpb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLmF1ZGlvID0gYXVkaW87XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P093dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzfSB2aWRlb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXNcbiAgICAgKi9cbiAgICB0aGlzLnZpZGVvID0gdmlkZW87XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgQXVkaW9TdWJzY3JpcHRpb25Db25zdHJhaW50c1xuICogQG1lbWJlck9mIE93dC5Db25mZXJlbmNlXG4gKiBAY2xhc3NEZXNjIFJlcHJlc2VudHMgdGhlIGF1ZGlvIGNvbnN0cmFpbnRzIGZvciBzdWJzY3JpcHRpb24uXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBBdWRpb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoY29kZWNzKSB7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P0FycmF5LjxPd3QuQmFzZS5BdWRpb0NvZGVjUGFyYW1ldGVycz59IGNvZGVjc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5BdWRpb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgQ29kZWNzIGFjY2VwdGVkLiBJZiBub25lIG9mIGBjb2RlY3NgIHN1cHBvcnRlZCBieSBib3RoIHNpZGVzLCBjb25uZWN0aW9uIGZhaWxzLiBMZWF2ZSBpdCB1bmRlZmluZWQgd2lsbCB1c2UgYWxsIHBvc3NpYmxlIGNvZGVjcy5cbiAgICAgKi9cbiAgICB0aGlzLmNvZGVjcyA9IGNvZGVjcztcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBWaWRlb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzXG4gKiBAbWVtYmVyT2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBjbGFzc0Rlc2MgUmVwcmVzZW50cyB0aGUgdmlkZW8gY29uc3RyYWludHMgZm9yIHN1YnNjcmlwdGlvbi5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFZpZGVvU3Vic2NyaXB0aW9uQ29uc3RyYWludHMge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3Rvcihjb2RlY3MsIHJlc29sdXRpb24sIGZyYW1lUmF0ZSwgYml0cmF0ZU11bHRpcGxpZXIsXG4gICAgICBrZXlGcmFtZUludGVydmFsLCByaWQpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/QXJyYXkuPE93dC5CYXNlLlZpZGVvQ29kZWNQYXJhbWV0ZXJzPn0gY29kZWNzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uQ29uc3RyYWludHNcbiAgICAgKiBAZGVzYyBDb2RlY3MgYWNjZXB0ZWQuIElmIG5vbmUgb2YgYGNvZGVjc2Agc3VwcG9ydGVkIGJ5IGJvdGggc2lkZXMsIGNvbm5lY3Rpb24gZmFpbHMuIExlYXZlIGl0IHVuZGVmaW5lZCB3aWxsIHVzZSBhbGwgcG9zc2libGUgY29kZWNzLlxuICAgICAqL1xuICAgIHRoaXMuY29kZWNzID0gY29kZWNzO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9Pd3QuQmFzZS5SZXNvbHV0aW9ufSByZXNvbHV0aW9uXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uQ29uc3RyYWludHNcbiAgICAgKiBAZGVzYyBPbmx5IHJlc29sdXRpb25zIGxpc3RlZCBpbiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyBhcmUgYWxsb3dlZC5cbiAgICAgKi9cbiAgICB0aGlzLnJlc29sdXRpb24gPSByZXNvbHV0aW9uO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9udW1iZXJ9IGZyYW1lUmF0ZVxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgT25seSBmcmFtZVJhdGVzIGxpc3RlZCBpbiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyBhcmUgYWxsb3dlZC5cbiAgICAgKi9cbiAgICB0aGlzLmZyYW1lUmF0ZSA9IGZyYW1lUmF0ZTtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/bnVtYmVyfSBiaXRyYXRlTXVsdGlwbGllclxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgT25seSBiaXRyYXRlTXVsdGlwbGllcnMgbGlzdGVkIGluIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzIGFyZSBhbGxvd2VkLlxuICAgICAqL1xuICAgIHRoaXMuYml0cmF0ZU11bHRpcGxpZXIgPSBiaXRyYXRlTXVsdGlwbGllcjtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/bnVtYmVyfSBrZXlGcmFtZUludGVydmFsXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uQ29uc3RyYWludHNcbiAgICAgKiBAZGVzYyBPbmx5IGtleUZyYW1lSW50ZXJ2YWxzIGxpc3RlZCBpbiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyBhcmUgYWxsb3dlZC5cbiAgICAgKi9cbiAgICB0aGlzLmtleUZyYW1lSW50ZXJ2YWwgPSBrZXlGcmFtZUludGVydmFsO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9udW1iZXJ9IHJpZFxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzXG4gICAgICogQGRlc2MgUmVzdHJpY3Rpb24gaWRlbnRpZmllciB0byBpZGVudGlmeSB0aGUgUlRQIFN0cmVhbXMgd2l0aGluIGFuIFJUUCBzZXNzaW9uLiBXaGVuIHJpZCBpcyBzcGVjaWZpZWQsIG90aGVyIGNvbnN0cmFpbnRzIHdpbGwgYmUgaWdub3JlZC5cbiAgICAgKi9cbiAgICB0aGlzLnJpZCA9IHJpZDtcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBTdWJzY3JpYmVPcHRpb25zXG4gKiBAbWVtYmVyT2YgT3d0LkNvbmZlcmVuY2VcbiAqIEBjbGFzc0Rlc2MgU3Vic2NyaWJlT3B0aW9ucyBkZWZpbmVzIG9wdGlvbnMgZm9yIHN1YnNjcmliaW5nIGEgT3d0LkJhc2UuUmVtb3RlU3RyZWFtLlxuICovXG5leHBvcnQgY2xhc3MgU3Vic2NyaWJlT3B0aW9ucyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKGF1ZGlvLCB2aWRlbykge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9Pd3QuQ29uZmVyZW5jZS5BdWRpb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzfSBhdWRpb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpYmVPcHRpb25zXG4gICAgICovXG4gICAgdGhpcy5hdWRpbyA9IGF1ZGlvO1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9Pd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvbkNvbnN0cmFpbnRzfSB2aWRlb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpYmVPcHRpb25zXG4gICAgICovXG4gICAgdGhpcy52aWRlbyA9IHZpZGVvO1xuICB9XG59XG5cbi8qKlxuICogQGNsYXNzIFZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9uc1xuICogQG1lbWJlck9mIE93dC5Db25mZXJlbmNlXG4gKiBAY2xhc3NEZXNjIFZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9ucyBkZWZpbmVzIG9wdGlvbnMgZm9yIHVwZGF0aW5nIGEgc3Vic2NyaXB0aW9uJ3MgdmlkZW8gcGFydC5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9ucyB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIC8qKlxuICAgICAqIEBtZW1iZXIgez9Pd3QuQmFzZS5SZXNvbHV0aW9ufSByZXNvbHV0aW9uXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9uc1xuICAgICAqIEBkZXNjIE9ubHkgcmVzb2x1dGlvbnMgbGlzdGVkIGluIFZpZGVvU3Vic2NyaXB0aW9uQ2FwYWJpbGl0aWVzIGFyZSBhbGxvd2VkLlxuICAgICAqL1xuICAgIHRoaXMucmVzb2x1dGlvbiA9IHVuZGVmaW5lZDtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/bnVtYmVyfSBmcmFtZVJhdGVzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9uc1xuICAgICAqIEBkZXNjIE9ubHkgZnJhbWVSYXRlcyBsaXN0ZWQgaW4gVmlkZW9TdWJzY3JpcHRpb25DYXBhYmlsaXRpZXMgYXJlIGFsbG93ZWQuXG4gICAgICovXG4gICAgdGhpcy5mcmFtZVJhdGUgPSB1bmRlZmluZWQ7XG4gICAgLyoqXG4gICAgICogQG1lbWJlciB7P251bWJlcn0gYml0cmF0ZU11bHRpcGxpZXJzXG4gICAgICogQGluc3RhbmNlXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlZpZGVvU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9uc1xuICAgICAqIEBkZXNjIE9ubHkgYml0cmF0ZU11bHRpcGxpZXJzIGxpc3RlZCBpbiBWaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyBhcmUgYWxsb3dlZC5cbiAgICAgKi9cbiAgICB0aGlzLmJpdHJhdGVNdWx0aXBsaWVycyA9IHVuZGVmaW5lZDtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/bnVtYmVyfSBrZXlGcmFtZUludGVydmFsc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5WaWRlb1N1YnNjcmlwdGlvblVwZGF0ZU9wdGlvbnNcbiAgICAgKiBAZGVzYyBPbmx5IGtleUZyYW1lSW50ZXJ2YWxzIGxpc3RlZCBpbiBWaWRlb1N1YnNjcmlwdGlvbkNhcGFiaWxpdGllcyBhcmUgYWxsb3dlZC5cbiAgICAgKi9cbiAgICB0aGlzLmtleUZyYW1lSW50ZXJ2YWwgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBAY2xhc3MgU3Vic2NyaXB0aW9uVXBkYXRlT3B0aW9uc1xuICogQG1lbWJlck9mIE93dC5Db25mZXJlbmNlXG4gKiBAY2xhc3NEZXNjIFN1YnNjcmlwdGlvblVwZGF0ZU9wdGlvbnMgZGVmaW5lcyBvcHRpb25zIGZvciB1cGRhdGluZyBhIHN1YnNjcmlwdGlvbi5cbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuZXhwb3J0IGNsYXNzIFN1YnNjcmlwdGlvblVwZGF0ZU9wdGlvbnMge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICAvKipcbiAgICAgKiBAbWVtYmVyIHs/VmlkZW9TdWJzY3JpcHRpb25VcGRhdGVPcHRpb25zfSB2aWRlb1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpcHRpb25VcGRhdGVPcHRpb25zXG4gICAgICovXG4gICAgdGhpcy52aWRlbyA9IHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIEBjbGFzcyBTdWJzY3JpcHRpb25cbiAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZVxuICogQGNsYXNzRGVzYyBTdWJzY3JpcHRpb24gaXMgYSByZWNlaXZlciBmb3IgcmVjZWl2aW5nIGEgc3RyZWFtLlxuICogRXZlbnRzOlxuICpcbiAqIHwgRXZlbnQgTmFtZSAgICAgIHwgQXJndW1lbnQgVHlwZSAgICB8IEZpcmVkIHdoZW4gICAgICAgfFxuICogfCAtLS0tLS0tLS0tLS0tLS0tfCAtLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLSB8XG4gKiB8IGVuZGVkICAgICAgICAgICB8IEV2ZW50ICAgICAgICAgICAgfCBTdWJzY3JpcHRpb24gaXMgZW5kZWQuIHxcbiAqIHwgZXJyb3IgICAgICAgICAgIHwgRXJyb3JFdmVudCAgICAgICB8IEFuIGVycm9yIG9jY3VycmVkIG9uIHRoZSBzdWJzY3JpcHRpb24uIHxcbiAqIHwgbXV0ZSAgICAgICAgICAgIHwgTXV0ZUV2ZW50ICAgICAgICB8IFB1YmxpY2F0aW9uIGlzIG11dGVkLiBSZW1vdGUgc2lkZSBzdG9wcGVkIHNlbmRpbmcgYXVkaW8gYW5kL29yIHZpZGVvIGRhdGEuIHxcbiAqIHwgdW5tdXRlICAgICAgICAgIHwgTXV0ZUV2ZW50ICAgICAgICB8IFB1YmxpY2F0aW9uIGlzIHVubXV0ZWQuIFJlbW90ZSBzaWRlIGNvbnRpbnVlZCBzZW5kaW5nIGF1ZGlvIGFuZC9vciB2aWRlbyBkYXRhLiB8XG4gKlxuICogQGV4dGVuZHMgT3d0LkJhc2UuRXZlbnREaXNwYXRjaGVyXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBTdWJzY3JpcHRpb24gZXh0ZW5kcyBFdmVudERpc3BhdGNoZXIge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVxdWlyZS1qc2RvY1xuICBjb25zdHJ1Y3RvcihpZCwgc3RvcCwgZ2V0U3RhdHMsIG11dGUsIHVubXV0ZSwgYXBwbHlPcHRpb25zKSB7XG4gICAgc3VwZXIoKTtcbiAgICBpZiAoIWlkKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJRCBjYW5ub3QgYmUgbnVsbCBvciB1bmRlZmluZWQuJyk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEBtZW1iZXIge3N0cmluZ30gaWRcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuU3Vic2NyaXB0aW9uXG4gICAgICovXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdpZCcsIHtcbiAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2UsXG4gICAgICB3cml0YWJsZTogZmFsc2UsXG4gICAgICB2YWx1ZTogaWQsXG4gICAgfSk7XG4gICAgLyoqXG4gICAgICogQGZ1bmN0aW9uIHN0b3BcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBTdG9wIGNlcnRhaW4gc3Vic2NyaXB0aW9uLiBPbmNlIGEgc3Vic2NyaXB0aW9uIGlzIHN0b3BwZWQsIGl0IGNhbm5vdCBiZSByZWNvdmVyZWQuXG4gICAgICogQG1lbWJlcm9mIE93dC5Db25mZXJlbmNlLlN1YnNjcmlwdGlvblxuICAgICAqIEByZXR1cm5zIHt1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5zdG9wID0gc3RvcDtcbiAgICAvKipcbiAgICAgKiBAZnVuY3Rpb24gZ2V0U3RhdHNcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBHZXQgc3RhdHMgb2YgdW5kZXJseWluZyBQZWVyQ29ubmVjdGlvbi5cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuU3Vic2NyaXB0aW9uXG4gICAgICogQHJldHVybnMge1Byb21pc2U8UlRDU3RhdHNSZXBvcnQsIEVycm9yPn1cbiAgICAgKi9cbiAgICB0aGlzLmdldFN0YXRzID0gZ2V0U3RhdHM7XG4gICAgLyoqXG4gICAgICogQGZ1bmN0aW9uIG11dGVcbiAgICAgKiBAaW5zdGFuY2VcbiAgICAgKiBAZGVzYyBTdG9wIHJlZXZpbmcgZGF0YSBmcm9tIHJlbW90ZSBlbmRwb2ludC5cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuU3Vic2NyaXB0aW9uXG4gICAgICogQHBhcmFtIHtPd3QuQmFzZS5UcmFja0tpbmQgfSBraW5kIEtpbmQgb2YgdHJhY2tzIHRvIGJlIG11dGVkLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHVuZGVmaW5lZCwgRXJyb3I+fVxuICAgICAqL1xuICAgIHRoaXMubXV0ZSA9IG11dGU7XG4gICAgLyoqXG4gICAgICogQGZ1bmN0aW9uIHVubXV0ZVxuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBkZXNjIENvbnRpbnVlIHJlZXZpbmcgZGF0YSBmcm9tIHJlbW90ZSBlbmRwb2ludC5cbiAgICAgKiBAbWVtYmVyb2YgT3d0LkNvbmZlcmVuY2UuU3Vic2NyaXB0aW9uXG4gICAgICogQHBhcmFtIHtPd3QuQmFzZS5UcmFja0tpbmQgfSBraW5kIEtpbmQgb2YgdHJhY2tzIHRvIGJlIHVubXV0ZWQuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dW5kZWZpbmVkLCBFcnJvcj59XG4gICAgICovXG4gICAgdGhpcy51bm11dGUgPSB1bm11dGU7XG4gICAgLyoqXG4gICAgICogQGZ1bmN0aW9uIGFwcGx5T3B0aW9uc1xuICAgICAqIEBpbnN0YW5jZVxuICAgICAqIEBkZXNjIFVwZGF0ZSBzdWJzY3JpcHRpb24gd2l0aCBnaXZlbiBvcHRpb25zLlxuICAgICAqIEBtZW1iZXJvZiBPd3QuQ29uZmVyZW5jZS5TdWJzY3JpcHRpb25cbiAgICAgKiBAcGFyYW0ge093dC5Db25mZXJlbmNlLlN1YnNjcmlwdGlvblVwZGF0ZU9wdGlvbnMgfSBvcHRpb25zIFN1YnNjcmlwdGlvbiB1cGRhdGUgb3B0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx1bmRlZmluZWQsIEVycm9yPn1cbiAgICAgKi9cbiAgICB0aGlzLmFwcGx5T3B0aW9ucyA9IGFwcGx5T3B0aW9ucztcbiAgfVxufVxuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4ndXNlIHN0cmljdCc7XG5cbmltcG9ydCAqIGFzIGJhc2UgZnJvbSAnLi9iYXNlL2V4cG9ydC5qcyc7XG5pbXBvcnQgKiBhcyBwMnAgZnJvbSAnLi9wMnAvZXhwb3J0LmpzJztcbmltcG9ydCAqIGFzIGNvbmZlcmVuY2UgZnJvbSAnLi9jb25mZXJlbmNlL2V4cG9ydC5qcyc7XG5cbi8qKlxuICogQmFzZSBvYmplY3RzIGZvciBib3RoIFAyUCBhbmQgY29uZmVyZW5jZS5cbiAqIEBuYW1lc3BhY2UgT3d0LkJhc2VcbiAqL1xuZXhwb3J0IGNvbnN0IEJhc2UgPSBiYXNlO1xuXG4vKipcbiAqIFAyUCBXZWJSVEMgY29ubmVjdGlvbnMuXG4gKiBAbmFtZXNwYWNlIE93dC5QMlBcbiAqL1xuZXhwb3J0IGNvbnN0IFAyUCA9IHAycDtcblxuLyoqXG4gKiBXZWJSVEMgY29ubmVjdGlvbnMgd2l0aCBjb25mZXJlbmNlIHNlcnZlci5cbiAqIEBuYW1lc3BhY2UgT3d0LkNvbmZlcmVuY2VcbiAqL1xuZXhwb3J0IGNvbnN0IENvbmZlcmVuY2UgPSBjb25mZXJlbmNlO1xuIiwiLy8gQ29weXJpZ2h0IChDKSA8MjAxOD4gSW50ZWwgQ29ycG9yYXRpb25cbi8vXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuXG4ndXNlIHN0cmljdCc7XG5cbmV4cG9ydCBjb25zdCBlcnJvcnMgPSB7XG4gIC8vIDIxMDAtMjk5OSBmb3IgUDJQIGVycm9yc1xuICAvLyAyMTAwLTIxOTkgZm9yIGNvbm5lY3Rpb24gZXJyb3JzXG4gIC8vIDIxMDAtMjEwOSBmb3Igc2VydmVyIGVycm9yc1xuICBQMlBfQ09OTl9TRVJWRVJfVU5LTk9XTjoge1xuICAgIGNvZGU6IDIxMDAsXG4gICAgbWVzc2FnZTogJ1NlcnZlciB1bmtub3duIGVycm9yLicsXG4gIH0sXG4gIFAyUF9DT05OX1NFUlZFUl9VTkFWQUlMQUJMRToge1xuICAgIGNvZGU6IDIxMDEsXG4gICAgbWVzc2FnZTogJ1NlcnZlciBpcyB1bmF2YWxpYWJsZS4nLFxuICB9LFxuICBQMlBfQ09OTl9TRVJWRVJfQlVTWToge1xuICAgIGNvZGU6IDIxMDIsXG4gICAgbWVzc2FnZTogJ1NlcnZlciBpcyB0b28gYnVzeS4nLFxuICB9LFxuICBQMlBfQ09OTl9TRVJWRVJfTk9UX1NVUFBPUlRFRDoge1xuICAgIGNvZGU6IDIxMDMsXG4gICAgbWVzc2FnZTogJ01ldGhvZCBoYXMgbm90IGJlZW4gc3VwcG9ydGVkIGJ5IHNlcnZlci4nLFxuICB9LFxuICAvLyAyMTEwLTIxMTkgZm9yIGNsaWVudCBlcnJvcnNcbiAgUDJQX0NPTk5fQ0xJRU5UX1VOS05PV046IHtcbiAgICBjb2RlOiAyMTEwLFxuICAgIG1lc3NhZ2U6ICdDbGllbnQgdW5rbm93biBlcnJvci4nLFxuICB9LFxuICBQMlBfQ09OTl9DTElFTlRfTk9UX0lOSVRJQUxJWkVEOiB7XG4gICAgY29kZTogMjExMSxcbiAgICBtZXNzYWdlOiAnQ29ubmVjdGlvbiBpcyBub3QgaW5pdGlhbGl6ZWQuJyxcbiAgfSxcbiAgLy8gMjEyMC0yMTI5IGZvciBhdXRoZW50aWNhdGlvbiBlcnJvcnNcbiAgUDJQX0NPTk5fQVVUSF9VTktOT1dOOiB7XG4gICAgY29kZTogMjEyMCxcbiAgICBtZXNzYWdlOiAnQXV0aGVudGljYXRpb24gdW5rbm93biBlcnJvci4nLFxuICB9LFxuICBQMlBfQ09OTl9BVVRIX0ZBSUxFRDoge1xuICAgIGNvZGU6IDIxMjEsXG4gICAgbWVzc2FnZTogJ1dyb25nIHVzZXJuYW1lIG9yIHRva2VuLicsXG4gIH0sXG4gIC8vIDIyMDAtMjI5OSBmb3IgbWVzc2FnZSB0cmFuc3BvcnQgZXJyb3JzXG4gIFAyUF9NRVNTQUdJTkdfVEFSR0VUX1VOUkVBQ0hBQkxFOiB7XG4gICAgY29kZTogMjIwMSxcbiAgICBtZXNzYWdlOiAnUmVtb3RlIHVzZXIgY2Fubm90IGJlIHJlYWNoZWQuJyxcbiAgfSxcbiAgUDJQX0NMSUVOVF9ERU5JRUQ6IHtcbiAgICBjb2RlOiAyMjAyLFxuICAgIG1lc3NhZ2U6ICdVc2VyIGlzIGRlbmllZC4nLFxuICB9LFxuICAvLyAyMzAxLTIzOTkgZm9yIGNoYXQgcm9vbSBlcnJvcnNcbiAgLy8gMjQwMS0yNDk5IGZvciBjbGllbnQgZXJyb3JzXG4gIFAyUF9DTElFTlRfVU5LTk9XTjoge1xuICAgIGNvZGU6IDI0MDAsXG4gICAgbWVzc2FnZTogJ1Vua25vd24gZXJyb3JzLicsXG4gIH0sXG4gIFAyUF9DTElFTlRfVU5TVVBQT1JURURfTUVUSE9EOiB7XG4gICAgY29kZTogMjQwMSxcbiAgICBtZXNzYWdlOiAnVGhpcyBtZXRob2QgaXMgdW5zdXBwb3J0ZWQgaW4gY3VycmVudCBicm93c2VyLicsXG4gIH0sXG4gIFAyUF9DTElFTlRfSUxMRUdBTF9BUkdVTUVOVDoge1xuICAgIGNvZGU6IDI0MDIsXG4gICAgbWVzc2FnZTogJ0lsbGVnYWwgYXJndW1lbnQuJyxcbiAgfSxcbiAgUDJQX0NMSUVOVF9JTlZBTElEX1NUQVRFOiB7XG4gICAgY29kZTogMjQwMyxcbiAgICBtZXNzYWdlOiAnSW52YWxpZCBwZWVyIHN0YXRlLicsXG4gIH0sXG4gIFAyUF9DTElFTlRfTk9UX0FMTE9XRUQ6IHtcbiAgICBjb2RlOiAyNDA0LFxuICAgIG1lc3NhZ2U6ICdSZW1vdGUgdXNlciBpcyBub3QgYWxsb3dlZC4nLFxuICB9LFxuICAvLyAyNTAxLTI1OTkgZm9yIFdlYlJUQyBlcnJvcy5cbiAgUDJQX1dFQlJUQ19VTktOT1dOOiB7XG4gICAgY29kZTogMjUwMCxcbiAgICBtZXNzYWdlOiAnV2ViUlRDIGVycm9yLicsXG4gIH0sXG4gIFAyUF9XRUJSVENfU0RQOiB7XG4gICAgY29kZTogMjUwMixcbiAgICBtZXNzYWdlOiAnU0RQIGVycm9yLicsXG4gIH0sXG59O1xuXG4vKipcbiAqIEBmdW5jdGlvbiBnZXRFcnJvckJ5Q29kZVxuICogQGRlc2MgR2V0IGVycm9yIG9iamVjdCBieSBlcnJvciBjb2RlLlxuICogQHBhcmFtIHtzdHJpbmd9IGVycm9yQ29kZSBFcnJvciBjb2RlLlxuICogQHJldHVybiB7T3d0LlAyUC5FcnJvcn0gRXJyb3Igb2JqZWN0XG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RXJyb3JCeUNvZGUoZXJyb3JDb2RlKSB7XG4gIGNvbnN0IGNvZGVFcnJvck1hcCA9IHtcbiAgICAyMTAwOiBlcnJvcnMuUDJQX0NPTk5fU0VSVkVSX1VOS05PV04sXG4gICAgMjEwMTogZXJyb3JzLlAyUF9DT05OX1NFUlZFUl9VTkFWQUlMQUJMRSxcbiAgICAyMTAyOiBlcnJvcnMuUDJQX0NPTk5fU0VSVkVSX0JVU1ksXG4gICAgMjEwMzogZXJyb3JzLlAyUF9DT05OX1NFUlZFUl9OT1RfU1VQUE9SVEVELFxuICAgIDIxMTA6IGVycm9ycy5QMlBfQ09OTl9DTElFTlRfVU5LTk9XTixcbiAgICAyMTExOiBlcnJvcnMuUDJQX0NPTk5fQ0xJRU5UX05PVF9JTklUSUFMSVpFRCxcbiAgICAyMTIwOiBlcnJvcnMuUDJQX0NPTk5fQVVUSF9VTktOT1dOLFxuICAgIDIxMjE6IGVycm9ycy5QMlBfQ09OTl9BVVRIX0ZBSUxFRCxcbiAgICAyMjAxOiBlcnJvcnMuUDJQX01FU1NBR0lOR19UQVJHRVRfVU5SRUFDSEFCTEUsXG4gICAgMjQwMDogZXJyb3JzLlAyUF9DTElFTlRfVU5LTk9XTixcbiAgICAyNDAxOiBlcnJvcnMuUDJQX0NMSUVOVF9VTlNVUFBPUlRFRF9NRVRIT0QsXG4gICAgMjQwMjogZXJyb3JzLlAyUF9DTElFTlRfSUxMRUdBTF9BUkdVTUVOVCxcbiAgICAyNDAzOiBlcnJvcnMuUDJQX0NMSUVOVF9JTlZBTElEX1NUQVRFLFxuICAgIDI0MDQ6IGVycm9ycy5QMlBfQ0xJRU5UX05PVF9BTExPV0VELFxuICAgIDI1MDA6IGVycm9ycy5QMlBfV0VCUlRDX1VOS05PV04sXG4gICAgMjUwMTogZXJyb3JzLlAyUF9XRUJSVENfU0RQLFxuICB9O1xuICByZXR1cm4gY29kZUVycm9yTWFwW2Vycm9yQ29kZV07XG59XG5cbi8qKlxuICogQGNsYXNzIFAyUEVycm9yXG4gKiBAY2xhc3NEZXNjIFRoZSBQMlBFcnJvciBvYmplY3QgcmVwcmVzZW50cyBhbiBlcnJvciBpbiBQMlAgbW9kZS5cbiAqIEBtZW1iZXJPZiBPd3QuUDJQXG4gKiBAaGlkZWNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBjbGFzcyBQMlBFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2NcbiAgY29uc3RydWN0b3IoZXJyb3IsIG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICBpZiAodHlwZW9mIGVycm9yID09PSAnbnVtYmVyJykge1xuICAgICAgdGhpcy5jb2RlID0gZXJyb3I7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuY29kZSA9IGVycm9yLmNvZGU7XG4gICAgfVxuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbid1c2Ugc3RyaWN0JztcblxuZXhwb3J0IHtkZWZhdWx0IGFzIFAyUENsaWVudH0gZnJvbSAnLi9wMnBjbGllbnQuanMnO1xuZXhwb3J0IHtQMlBFcnJvcn0gZnJvbSAnLi9lcnJvci5qcyc7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8qIGdsb2JhbCBNYXAsIFByb21pc2UgKi9cblxuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IExvZ2dlciBmcm9tICcuLi9iYXNlL2xvZ2dlci5qcyc7XG5pbXBvcnQge0V2ZW50RGlzcGF0Y2hlciwgT3d0RXZlbnR9IGZyb20gJy4uL2Jhc2UvZXZlbnQuanMnO1xuaW1wb3J0ICogYXMgVXRpbHMgZnJvbSAnLi4vYmFzZS91dGlscy5qcyc7XG5pbXBvcnQgKiBhcyBFcnJvck1vZHVsZSBmcm9tICcuL2Vycm9yLmpzJztcbmltcG9ydCBQMlBQZWVyQ29ubmVjdGlvbkNoYW5uZWwgZnJvbSAnLi9wZWVyY29ubmVjdGlvbi1jaGFubmVsLmpzJztcblxuY29uc3QgQ29ubmVjdGlvblN0YXRlID0ge1xuICBSRUFEWTogMSxcbiAgQ09OTkVDVElORzogMixcbiAgQ09OTkVDVEVEOiAzLFxufTtcblxuLyogZXNsaW50LWRpc2FibGUgbm8tdW51c2VkLXZhcnMgKi9cbi8qKlxuICogQGNsYXNzIFAyUENsaWVudENvbmZpZ3VyYXRpb25cbiAqIEBjbGFzc0Rlc2MgQ29uZmlndXJhdGlvbiBmb3IgUDJQQ2xpZW50LlxuICogQG1lbWJlck9mIE93dC5QMlBcbiAqIEBoaWRlY29uc3RydWN0b3JcbiAqL1xuY29uc3QgUDJQQ2xpZW50Q29uZmlndXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAvKipcbiAgICogQG1lbWJlciB7P0FycmF5PE93dC5CYXNlLkF1ZGlvRW5jb2RpbmdQYXJhbWV0ZXJzPn0gYXVkaW9FbmNvZGluZ1xuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgRW5jb2RpbmcgcGFyYW1ldGVycyBmb3IgcHVibGlzaGluZyBhdWRpbyB0cmFja3MuXG4gICAqIEBtZW1iZXJvZiBPd3QuUDJQLlAyUENsaWVudENvbmZpZ3VyYXRpb25cbiAgICovXG4gIHRoaXMuYXVkaW9FbmNvZGluZyA9IHVuZGVmaW5lZDtcbiAgLyoqXG4gICAqIEBtZW1iZXIgez9BcnJheTxPd3QuQmFzZS5WaWRlb0VuY29kaW5nUGFyYW1ldGVycz59IHZpZGVvRW5jb2RpbmdcbiAgICogQGluc3RhbmNlXG4gICAqIEBkZXNjIEVuY29kaW5nIHBhcmFtZXRlcnMgZm9yIHB1Ymxpc2hpbmcgdmlkZW8gdHJhY2tzLlxuICAgKiBAbWVtYmVyb2YgT3d0LlAyUC5QMlBDbGllbnRDb25maWd1cmF0aW9uXG4gICAqL1xuICB0aGlzLnZpZGVvRW5jb2RpbmcgPSB1bmRlZmluZWQ7XG4gIC8qKlxuICAgKiBAbWVtYmVyIHs/UlRDQ29uZmlndXJhdGlvbn0gcnRjQ29uZmlndXJhdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50Q29uZmlndXJhdGlvblxuICAgKiBAZGVzYyBJdCB3aWxsIGJlIHVzZWQgZm9yIGNyZWF0aW5nIFBlZXJDb25uZWN0aW9uLlxuICAgKiBAc2VlIHtAbGluayBodHRwczovL3d3dy53My5vcmcvVFIvd2VicnRjLyNydGNjb25maWd1cmF0aW9uLWRpY3Rpb25hcnl8UlRDQ29uZmlndXJhdGlvbiBEaWN0aW9uYXJ5IG9mIFdlYlJUQyAxLjB9LlxuICAgKiBAZXhhbXBsZVxuICAgKiAvLyBGb2xsb3dpbmcgb2JqZWN0IGNhbiBiZSBzZXQgdG8gcDJwQ2xpZW50Q29uZmlndXJhdGlvbi5ydGNDb25maWd1cmF0aW9uLlxuICAgKiB7XG4gICAqICAgaWNlU2VydmVyczogW3tcbiAgICogICAgICB1cmxzOiBcInN0dW46ZXhhbXBsZS5jb206MzQ3OFwiXG4gICAqICAgfSwge1xuICAgKiAgICAgdXJsczogW1xuICAgKiAgICAgICBcInR1cm46ZXhhbXBsZS5jb206MzQ3OD90cmFuc3BvcnQ9dWRwXCIsXG4gICAqICAgICAgIFwidHVybjpleGFtcGxlLmNvbTozNDc4P3RyYW5zcG9ydD10Y3BcIlxuICAgKiAgICAgXSxcbiAgICogICAgICBjcmVkZW50aWFsOiBcInBhc3N3b3JkXCIsXG4gICAqICAgICAgdXNlcm5hbWU6IFwidXNlcm5hbWVcIlxuICAgKiAgIH1cbiAgICogfVxuICAgKi9cbiAgdGhpcy5ydGNDb25maWd1cmF0aW9uID0gdW5kZWZpbmVkO1xufTtcbi8qIGVzbGludC1lbmFibGUgbm8tdW51c2VkLXZhcnMgKi9cblxuLyoqXG4gKiBAY2xhc3MgUDJQQ2xpZW50XG4gKiBAY2xhc3NEZXNjIFRoZSBQMlBDbGllbnQgaGFuZGxlcyBQZWVyQ29ubmVjdGlvbnMgYmV0d2VlbiBkaWZmZXJlbnQgY2xpZW50cy5cbiAqIEV2ZW50czpcbiAqXG4gKiB8IEV2ZW50IE5hbWUgICAgICAgICAgICB8IEFyZ3VtZW50IFR5cGUgICAgfCBGaXJlZCB3aGVuICAgICAgIHxcbiAqIHwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHwgLS0tLS0tLS0tLS0tLS0tLSB8IC0tLS0tLS0tLS0tLS0tLS0gfFxuICogfCBzdHJlYW1hZGRlZCAgICAgICAgICAgfCBTdHJlYW1FdmVudCAgICAgIHwgQSBuZXcgc3RyZWFtIGlzIHNlbnQgZnJvbSByZW1vdGUgZW5kcG9pbnQuIHxcbiAqIHwgbWVzc2FnZXJlY2VpdmVkICAgICAgIHwgTWVzc2FnZUV2ZW50ICAgICB8IEEgbmV3IG1lc3NhZ2UgaXMgcmVjZWl2ZWQuIHxcbiAqIHwgc2VydmVyZGlzY29ubmVjdGVkICAgIHwgT3d0RXZlbnQgICAgICAgICB8IERpc2Nvbm5lY3RlZCBmcm9tIHNpZ25hbGluZyBzZXJ2ZXIuIHxcbiAqXG4gKiBAbWVtYmVyb2YgT3d0LlAyUFxuICogQGV4dGVuZHMgT3d0LkJhc2UuRXZlbnREaXNwYXRjaGVyXG4gKiBAY29uc3RydWN0b3JcbiAqIEBwYXJhbSB7P093dC5QMlAuUDJQQ2xpZW50Q29uZmlndXJhdGlvbiB9IGNvbmZpZ3VyYXRpb24gQ29uZmlndXJhdGlvbiBmb3IgT3d0LlAyUC5QMlBDbGllbnQuXG4gKiBAcGFyYW0ge09iamVjdH0gc2lnbmFsaW5nQ2hhbm5lbCBBIGNoYW5uZWwgZm9yIHNlbmRpbmcgYW5kIHJlY2VpdmluZyBzaWduYWxpbmcgbWVzc2FnZXMuXG4gKi9cbmNvbnN0IFAyUENsaWVudCA9IGZ1bmN0aW9uKGNvbmZpZ3VyYXRpb24sIHNpZ25hbGluZ0NoYW5uZWwpIHtcbiAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIG5ldyBFdmVudERpc3BhdGNoZXIoKSk7XG4gIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb247XG4gIGNvbnN0IHNpZ25hbGluZyA9IHNpZ25hbGluZ0NoYW5uZWw7XG4gIGNvbnN0IGNoYW5uZWxzID0gbmV3IE1hcCgpOyAvLyBNYXAgb2YgUGVlckNvbm5lY3Rpb25DaGFubmVscy5cbiAgY29uc3Qgc2VsZj10aGlzO1xuICBsZXQgc3RhdGUgPSBDb25uZWN0aW9uU3RhdGUuUkVBRFk7XG4gIGxldCBteUlkO1xuXG4gIHNpZ25hbGluZy5vbk1lc3NhZ2UgPSBmdW5jdGlvbihvcmlnaW4sIG1lc3NhZ2UpIHtcbiAgICBMb2dnZXIuZGVidWcoJ1JlY2VpdmVkIHNpZ25hbGluZyBtZXNzYWdlIGZyb20gJyArIG9yaWdpbiArICc6ICcgKyBtZXNzYWdlKTtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcbiAgICBpZiAoZGF0YS50eXBlID09PSAnY2hhdC1jbG9zZWQnKSB7XG4gICAgICBpZiAoY2hhbm5lbHMuaGFzKG9yaWdpbikpIHtcbiAgICAgICAgZ2V0T3JDcmVhdGVDaGFubmVsKG9yaWdpbikub25NZXNzYWdlKGRhdGEpO1xuICAgICAgICBjaGFubmVscy5kZWxldGUob3JpZ2luKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHNlbGYuYWxsb3dlZFJlbW90ZUlkcy5pbmRleE9mKG9yaWdpbikgPj0gMCkge1xuICAgICAgZ2V0T3JDcmVhdGVDaGFubmVsKG9yaWdpbikub25NZXNzYWdlKGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZW5kU2lnbmFsaW5nTWVzc2FnZShvcmlnaW4sICdjaGF0LWNsb3NlZCcsXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfREVOSUVEKTtcbiAgICB9XG4gIH07XG5cbiAgc2lnbmFsaW5nLm9uU2VydmVyRGlzY29ubmVjdGVkID0gZnVuY3Rpb24oKSB7XG4gICAgc3RhdGUgPSBDb25uZWN0aW9uU3RhdGUuUkVBRFk7XG4gICAgc2VsZi5kaXNwYXRjaEV2ZW50KG5ldyBPd3RFdmVudCgnc2VydmVyZGlzY29ubmVjdGVkJykpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAbWVtYmVyIHthcnJheX0gYWxsb3dlZFJlbW90ZUlkc1xuICAgKiBAbWVtYmVyb2YgT3d0LlAyUC5QMlBDbGllbnRcbiAgICogQGluc3RhbmNlXG4gICAqIEBkZXNjIE9ubHkgYWxsb3dlZCByZW1vdGUgZW5kcG9pbnQgSURzIGFyZSBhYmxlIHRvIHB1Ymxpc2ggc3RyZWFtIG9yIHNlbmQgbWVzc2FnZSB0byBjdXJyZW50IGVuZHBvaW50LiBSZW1vdmluZyBhbiBJRCBmcm9tIGFsbG93ZWRSZW1vdGVJZHMgZG9lcyBzdG9wIGV4aXN0aW5nIGNvbm5lY3Rpb24gd2l0aCBjZXJ0YWluIGVuZHBvaW50LiBQbGVhc2UgY2FsbCBzdG9wIHRvIHN0b3AgdGhlIFBlZXJDb25uZWN0aW9uLlxuICAgKi9cbiAgdGhpcy5hbGxvd2VkUmVtb3RlSWRzPVtdO1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gY29ubmVjdFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgQ29ubmVjdCB0byBzaWduYWxpbmcgc2VydmVyLiBTaW5jZSBzaWduYWxpbmcgY2FuIGJlIGN1c3RvbWl6ZWQsIHRoaXMgbWV0aG9kIGRvZXMgbm90IGRlZmluZSBob3cgYSB0b2tlbiBsb29rcyBsaWtlLiBTREsgcGFzc2VzIHRva2VuIHRvIHNpZ25hbGluZyBjaGFubmVsIHdpdGhvdXQgY2hhbmdlcy5cbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50XG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0b2tlbiBBIHRva2VuIGZvciBjb25uZWN0aW5nIHRvIHNpZ25hbGluZyBzZXJ2ZXIuIFRoZSBmb3JtYXQgb2YgdGhpcyB0b2tlbiBkZXBlbmRzIG9uIHNpZ25hbGluZyBzZXJ2ZXIncyByZXF1aXJlbWVudC5cbiAgICogQHJldHVybiB7UHJvbWlzZTxvYmplY3QsIEVycm9yPn0gSXQgcmV0dXJucyBhIHByb21pc2UgcmVzb2x2ZWQgd2l0aCBhbiBvYmplY3QgcmV0dXJuZWQgYnkgc2lnbmFsaW5nIGNoYW5uZWwgb25jZSBzaWduYWxpbmcgY2hhbm5lbCByZXBvcnRzIGNvbm5lY3Rpb24gaGFzIGJlZW4gZXN0YWJsaXNoZWQuXG4gICAqL1xuICB0aGlzLmNvbm5lY3QgPSBmdW5jdGlvbih0b2tlbikge1xuICAgIGlmIChzdGF0ZSA9PT0gQ29ubmVjdGlvblN0YXRlLlJFQURZKSB7XG4gICAgICBzdGF0ZSA9IENvbm5lY3Rpb25TdGF0ZS5DT05ORUNUSU5HO1xuICAgIH0gZWxzZSB7XG4gICAgICBMb2dnZXIud2FybmluZygnSW52YWxpZCBjb25uZWN0aW9uIHN0YXRlOiAnICsgc3RhdGUpO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvck1vZHVsZS5QMlBFcnJvcihcbiAgICAgICAgICBFcnJvck1vZHVsZS5lcnJvcnMuUDJQX0NMSUVOVF9JTlZBTElEX1NUQVRFKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBzaWduYWxpbmcuY29ubmVjdCh0b2tlbikudGhlbigoaWQpID0+IHtcbiAgICAgICAgbXlJZCA9IGlkO1xuICAgICAgICBzdGF0ZSA9IENvbm5lY3Rpb25TdGF0ZS5DT05ORUNURUQ7XG4gICAgICAgIHJlc29sdmUobXlJZCk7XG4gICAgICB9LCAoZXJyQ29kZSkgPT4ge1xuICAgICAgICByZWplY3QobmV3IEVycm9yTW9kdWxlLlAyUEVycm9yKEVycm9yTW9kdWxlLmdldEVycm9yQnlDb2RlKFxuICAgICAgICAgICAgZXJyQ29kZSkpKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gZGlzY29ubmVjdFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgRGlzY29ubmVjdCBmcm9tIHRoZSBzaWduYWxpbmcgY2hhbm5lbC4gSXQgc3RvcHMgYWxsIGV4aXN0aW5nIHNlc3Npb25zIHdpdGggcmVtb3RlIGVuZHBvaW50cy5cbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHVuZGVmaW5lZCwgRXJyb3I+fVxuICAgKi9cbiAgdGhpcy5kaXNjb25uZWN0ID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHN0YXRlID09IENvbm5lY3Rpb25TdGF0ZS5SRUFEWSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjaGFubmVscy5mb3JFYWNoKChjaGFubmVsKT0+e1xuICAgICAgY2hhbm5lbC5zdG9wKCk7XG4gICAgfSk7XG4gICAgY2hhbm5lbHMuY2xlYXIoKTtcbiAgICBzaWduYWxpbmcuZGlzY29ubmVjdCgpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gcHVibGlzaFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgUHVibGlzaCBhIHN0cmVhbSB0byBhIHJlbW90ZSBlbmRwb2ludC5cbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVJZCBSZW1vdGUgZW5kcG9pbnQncyBJRC5cbiAgICogQHBhcmFtIHtPd3QuQmFzZS5Mb2NhbFN0cmVhbX0gc3RyZWFtIEFuIE93dC5CYXNlLkxvY2FsU3RyZWFtIHRvIGJlIHB1Ymxpc2hlZC5cbiAgICogQHJldHVybiB7UHJvbWlzZTxPd3QuQmFzZS5QdWJsaWNhdGlvbiwgRXJyb3I+fSBBIHByb21pc2VkIHRoYXQgcmVzb2x2ZXMgd2hlbiByZW1vdGUgc2lkZSByZWNlaXZlZCB0aGUgY2VydGFpbiBzdHJlYW0uIEhvd2V2ZXIsIHJlbW90ZSBlbmRwb2ludCBtYXkgbm90IGRpc3BsYXkgdGhpcyBzdHJlYW0sIG9yIGlnbm9yZSBpdC5cbiAgICovXG4gIHRoaXMucHVibGlzaCA9IGZ1bmN0aW9uKHJlbW90ZUlkLCBzdHJlYW0pIHtcbiAgICBpZiAoc3RhdGUgIT09IENvbm5lY3Rpb25TdGF0ZS5DT05ORUNURUQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSU5WQUxJRF9TVEFURSxcbiAgICAgICAgICAnUDJQIENsaWVudCBpcyBub3QgY29ubmVjdGVkIHRvIHNpZ25hbGluZyBjaGFubmVsLicpKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuYWxsb3dlZFJlbW90ZUlkcy5pbmRleE9mKHJlbW90ZUlkKSA8IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfTk9UX0FMTE9XRUQpKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShnZXRPckNyZWF0ZUNoYW5uZWwocmVtb3RlSWQpLnB1Ymxpc2goc3RyZWFtKSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBzZW5kXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBTZW5kIGEgbWVzc2FnZSB0byByZW1vdGUgZW5kcG9pbnQuXG4gICAqIEBtZW1iZXJvZiBPd3QuUDJQLlAyUENsaWVudFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlSWQgUmVtb3RlIGVuZHBvaW50J3MgSUQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIE1lc3NhZ2UgdG8gYmUgc2VudC4gSXQgc2hvdWxkIGJlIGEgc3RyaW5nLlxuICAgKiBAcmV0dXJuIHtQcm9taXNlPHVuZGVmaW5lZCwgRXJyb3I+fSBJdCByZXR1cm5zIGEgcHJvbWlzZSByZXNvbHZlZCB3aGVuIHJlbW90ZSBlbmRwb2ludCByZWNlaXZlZCBjZXJ0YWluIG1lc3NhZ2UuXG4gICAqL1xuICB0aGlzLnNlbmQ9ZnVuY3Rpb24ocmVtb3RlSWQsIG1lc3NhZ2UpIHtcbiAgICBpZiAoc3RhdGUgIT09IENvbm5lY3Rpb25TdGF0ZS5DT05ORUNURUQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSU5WQUxJRF9TVEFURSxcbiAgICAgICAgICAnUDJQIENsaWVudCBpcyBub3QgY29ubmVjdGVkIHRvIHNpZ25hbGluZyBjaGFubmVsLicpKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuYWxsb3dlZFJlbW90ZUlkcy5pbmRleE9mKHJlbW90ZUlkKSA8IDApIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfTk9UX0FMTE9XRUQpKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShnZXRPckNyZWF0ZUNoYW5uZWwocmVtb3RlSWQpLnNlbmQobWVzc2FnZSkpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gc3RvcFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGRlc2MgQ2xlYW4gYWxsIHJlc291cmNlcyBhc3NvY2lhdGVkIHdpdGggZ2l2ZW4gcmVtb3RlIGVuZHBvaW50LiBJdCBtYXkgaW5jbHVkZSBSVENQZWVyQ29ubmVjdGlvbiwgUlRDUnRwVHJhbnNjZWl2ZXIgYW5kIFJUQ0RhdGFDaGFubmVsLiBJdCBzdGlsbCBwb3NzaWJsZSB0byBwdWJsaXNoIGEgc3RyZWFtLCBvciBzZW5kIGEgbWVzc2FnZSB0byBnaXZlbiByZW1vdGUgZW5kcG9pbnQgYWZ0ZXIgc3RvcC5cbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVJZCBSZW1vdGUgZW5kcG9pbnQncyBJRC5cbiAgICogQHJldHVybiB7dW5kZWZpbmVkfVxuICAgKi9cbiAgdGhpcy5zdG9wID0gZnVuY3Rpb24ocmVtb3RlSWQpIHtcbiAgICBpZiAoIWNoYW5uZWxzLmhhcyhyZW1vdGVJZCkpIHtcbiAgICAgIExvZ2dlci53YXJuaW5nKFxuICAgICAgICAgICdObyBQZWVyQ29ubmVjdGlvbiBiZXR3ZWVuIGN1cnJlbnQgZW5kcG9pbnQgYW5kIHNwZWNpZmljIHJlbW90ZSAnICtcbiAgICAgICAgICAnZW5kcG9pbnQuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2hhbm5lbHMuZ2V0KHJlbW90ZUlkKS5zdG9wKCk7XG4gICAgY2hhbm5lbHMuZGVsZXRlKHJlbW90ZUlkKTtcbiAgfTtcblxuICAvKipcbiAgICogQGZ1bmN0aW9uIGdldFN0YXRzXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAZGVzYyBHZXQgc3RhdHMgb2YgdW5kZXJseWluZyBQZWVyQ29ubmVjdGlvbi5cbiAgICogQG1lbWJlcm9mIE93dC5QMlAuUDJQQ2xpZW50XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVJZCBSZW1vdGUgZW5kcG9pbnQncyBJRC5cbiAgICogQHJldHVybiB7UHJvbWlzZTxSVENTdGF0c1JlcG9ydCwgRXJyb3I+fSBJdCByZXR1cm5zIGEgcHJvbWlzZSByZXNvbHZlZCB3aXRoIGFuIFJUQ1N0YXRzUmVwb3J0IG9yIHJlamVjdCB3aXRoIGFuIEVycm9yIGlmIHRoZXJlIGlzIG5vIGNvbm5lY3Rpb24gd2l0aCBzcGVjaWZpYyB1c2VyLlxuICAgKi9cbiAgdGhpcy5nZXRTdGF0cyA9IGZ1bmN0aW9uKHJlbW90ZUlkKSB7XG4gICAgaWYgKCFjaGFubmVscy5oYXMocmVtb3RlSWQpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yTW9kdWxlLlAyUEVycm9yKFxuICAgICAgICAgIEVycm9yTW9kdWxlLmVycm9ycy5QMlBfQ0xJRU5UX0lOVkFMSURfU1RBVEUsXG4gICAgICAgICAgJ05vIFBlZXJDb25uZWN0aW9uIGJldHdlZW4gY3VycmVudCBlbmRwb2ludCBhbmQgc3BlY2lmaWMgcmVtb3RlICcgK1xuICAgICAgICAgICdlbmRwb2ludC4nKSk7XG4gICAgfVxuICAgIHJldHVybiBjaGFubmVscy5nZXQocmVtb3RlSWQpLmdldFN0YXRzKCk7XG4gIH07XG5cbiAgY29uc3Qgc2VuZFNpZ25hbGluZ01lc3NhZ2UgPSBmdW5jdGlvbihyZW1vdGVJZCwgdHlwZSwgbWVzc2FnZSkge1xuICAgIGNvbnN0IG1zZyA9IHtcbiAgICAgIHR5cGU6IHR5cGUsXG4gICAgfTtcbiAgICBpZiAobWVzc2FnZSkge1xuICAgICAgbXNnLmRhdGEgPSBtZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gc2lnbmFsaW5nLnNlbmQocmVtb3RlSWQsIEpTT04uc3RyaW5naWZ5KG1zZykpLmNhdGNoKChlKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IEVycm9yTW9kdWxlLmdldEVycm9yQnlDb2RlKGUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIGNvbnN0IGdldE9yQ3JlYXRlQ2hhbm5lbCA9IGZ1bmN0aW9uKHJlbW90ZUlkKSB7XG4gICAgaWYgKCFjaGFubmVscy5oYXMocmVtb3RlSWQpKSB7XG4gICAgICAvLyBDb25zdHJ1Y3QgYW4gc2lnbmFsaW5nIHNlbmRlci9yZWNlaXZlciBmb3IgUDJQUGVlckNvbm5lY3Rpb24uXG4gICAgICBjb25zdCBzaWduYWxpbmdGb3JDaGFubmVsID0gT2JqZWN0LmNyZWF0ZShFdmVudERpc3BhdGNoZXIpO1xuICAgICAgc2lnbmFsaW5nRm9yQ2hhbm5lbC5zZW5kU2lnbmFsaW5nTWVzc2FnZSA9IHNlbmRTaWduYWxpbmdNZXNzYWdlO1xuICAgICAgY29uc3QgcGNjID0gbmV3IFAyUFBlZXJDb25uZWN0aW9uQ2hhbm5lbChjb25maWcsIG15SWQsIHJlbW90ZUlkLFxuICAgICAgICAgIHNpZ25hbGluZ0ZvckNoYW5uZWwpO1xuICAgICAgcGNjLmFkZEV2ZW50TGlzdGVuZXIoJ3N0cmVhbWFkZGVkJywgKHN0cmVhbUV2ZW50KT0+e1xuICAgICAgICBzZWxmLmRpc3BhdGNoRXZlbnQoc3RyZWFtRXZlbnQpO1xuICAgICAgfSk7XG4gICAgICBwY2MuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZXJlY2VpdmVkJywgKG1lc3NhZ2VFdmVudCk9PntcbiAgICAgICAgc2VsZi5kaXNwYXRjaEV2ZW50KG1lc3NhZ2VFdmVudCk7XG4gICAgICB9KTtcbiAgICAgIHBjYy5hZGRFdmVudExpc3RlbmVyKCdlbmRlZCcsICgpPT57XG4gICAgICAgIGNoYW5uZWxzLmRlbGV0ZShyZW1vdGVJZCk7XG4gICAgICB9KTtcbiAgICAgIGNoYW5uZWxzLnNldChyZW1vdGVJZCwgcGNjKTtcbiAgICB9XG4gICAgcmV0dXJuIGNoYW5uZWxzLmdldChyZW1vdGVJZCk7XG4gIH07XG59O1xuXG5leHBvcnQgZGVmYXVsdCBQMlBDbGllbnQ7XG4iLCIvLyBDb3B5cmlnaHQgKEMpIDwyMDE4PiBJbnRlbCBDb3Jwb3JhdGlvblxuLy9cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbi8vIFRoaXMgZmlsZSBkb2Vzbid0IGhhdmUgcHVibGljIEFQSXMuXG4vKiBlc2xpbnQtZGlzYWJsZSB2YWxpZC1qc2RvYyAqL1xuLyogZXNsaW50LWRpc2FibGUgcmVxdWlyZS1qc2RvYyAqL1xuLyogZ2xvYmFsIEV2ZW50LCBNYXAsIFByb21pc2UsIFJUQ0ljZUNhbmRpZGF0ZSAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbmltcG9ydCBMb2dnZXIgZnJvbSAnLi4vYmFzZS9sb2dnZXIuanMnO1xuaW1wb3J0IHtFdmVudERpc3BhdGNoZXIsIE1lc3NhZ2VFdmVudCwgT3d0RXZlbnR9IGZyb20gJy4uL2Jhc2UvZXZlbnQuanMnO1xuaW1wb3J0IHtQdWJsaWNhdGlvbn0gZnJvbSAnLi4vYmFzZS9wdWJsaWNhdGlvbi5qcyc7XG5pbXBvcnQgKiBhcyBVdGlscyBmcm9tICcuLi9iYXNlL3V0aWxzLmpzJztcbmltcG9ydCAqIGFzIEVycm9yTW9kdWxlIGZyb20gJy4vZXJyb3IuanMnO1xuaW1wb3J0ICogYXMgU3RyZWFtTW9kdWxlIGZyb20gJy4uL2Jhc2Uvc3RyZWFtLmpzJztcbmltcG9ydCAqIGFzIFNkcFV0aWxzIGZyb20gJy4uL2Jhc2Uvc2RwdXRpbHMuanMnO1xuXG4vKipcbiAqIEBjbGFzcyBQMlBQZWVyQ29ubmVjdGlvbkNoYW5uZWxFdmVudFxuICogQGRlc2MgRXZlbnQgZm9yIFN0cmVhbS5cbiAqIEBtZW1iZXJPZiBPd3QuUDJQXG4gKiBAcHJpdmF0ZVxuICogKi9cbmV4cG9ydCBjbGFzcyBQMlBQZWVyQ29ubmVjdGlvbkNoYW5uZWxFdmVudCBleHRlbmRzIEV2ZW50IHtcbiAgLyogZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtanNkb2MgKi9cbiAgY29uc3RydWN0b3IoaW5pdCkge1xuICAgIHN1cGVyKGluaXQpO1xuICAgIHRoaXMuc3RyZWFtID0gaW5pdC5zdHJlYW07XG4gIH1cbn1cblxuY29uc3QgRGF0YUNoYW5uZWxMYWJlbCA9IHtcbiAgTUVTU0FHRTogJ21lc3NhZ2UnLFxuICBGSUxFOiAnZmlsZScsXG59O1xuXG5jb25zdCBTaWduYWxpbmdUeXBlID0ge1xuICBERU5JRUQ6ICdjaGF0LWRlbmllZCcsXG4gIENMT1NFRDogJ2NoYXQtY2xvc2VkJyxcbiAgTkVHT1RJQVRJT05fTkVFREVEOiAnY2hhdC1uZWdvdGlhdGlvbi1uZWVkZWQnLFxuICBUUkFDS19TT1VSQ0VTOiAnY2hhdC10cmFjay1zb3VyY2VzJyxcbiAgU1RSRUFNX0lORk86ICdjaGF0LXN0cmVhbS1pbmZvJyxcbiAgU0RQOiAnY2hhdC1zaWduYWwnLFxuICBUUkFDS1NfQURERUQ6ICdjaGF0LXRyYWNrcy1hZGRlZCcsXG4gIFRSQUNLU19SRU1PVkVEOiAnY2hhdC10cmFja3MtcmVtb3ZlZCcsXG4gIERBVEFfUkVDRUlWRUQ6ICdjaGF0LWRhdGEtcmVjZWl2ZWQnLFxuICBVQTogJ2NoYXQtdWEnLFxufTtcblxuY29uc3Qgc3lzSW5mbyA9IFV0aWxzLnN5c0luZm8oKTtcblxuLyoqXG4gKiBAY2xhc3MgUDJQUGVlckNvbm5lY3Rpb25DaGFubmVsXG4gKiBAZGVzYyBBIFAyUFBlZXJDb25uZWN0aW9uQ2hhbm5lbCBoYW5kbGVzIGFsbCBpbnRlcmFjdGlvbnMgYmV0d2VlbiB0aGlzIGVuZHBvaW50IGFuZCBhIHJlbW90ZSBlbmRwb2ludC5cbiAqIEBtZW1iZXJPZiBPd3QuUDJQXG4gKiBAcHJpdmF0ZVxuICovXG5jbGFzcyBQMlBQZWVyQ29ubmVjdGlvbkNoYW5uZWwgZXh0ZW5kcyBFdmVudERpc3BhdGNoZXIge1xuICAvLyB8c2lnbmFsaW5nfCBpcyBhbiBvYmplY3QgaGFzIGEgbWV0aG9kIHxzZW5kU2lnbmFsaW5nTWVzc2FnZXwuXG4gIC8qIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWpzZG9jICovXG4gIGNvbnN0cnVjdG9yKGNvbmZpZywgbG9jYWxJZCwgcmVtb3RlSWQsIHNpZ25hbGluZykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5fY29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuX2xvY2FsSWQgPSBsb2NhbElkO1xuICAgIHRoaXMuX3JlbW90ZUlkID0gcmVtb3RlSWQ7XG4gICAgdGhpcy5fc2lnbmFsaW5nID0gc2lnbmFsaW5nO1xuICAgIHRoaXMuX3BjID0gbnVsbDtcbiAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1zID0gbmV3IE1hcCgpOyAvLyBLZXkgaXMgc3RyZWFtcyBwdWJsaXNoZWQsIHZhbHVlIGlzIGl0cyBwdWJsaWNhdGlvbi5cbiAgICB0aGlzLl9wZW5kaW5nU3RyZWFtcyA9IFtdOyAvLyBTdHJlYW1zIGdvaW5nIHRvIGJlIGFkZGVkIHRvIFBlZXJDb25uZWN0aW9uLlxuICAgIHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1zID0gW107IC8vIFN0cmVhbXMgaGF2ZSBiZWVuIGFkZGVkIHRvIFBlZXJDb25uZWN0aW9uLCBidXQgZG9lcyBub3QgcmVjZWl2ZSBhY2sgZnJvbSByZW1vdGUgc2lkZS5cbiAgICB0aGlzLl9wZW5kaW5nVW5wdWJsaXNoU3RyZWFtcyA9IFtdOyAvLyBTdHJlYW1zIGdvaW5nIHRvIGJlIHJlbW92ZWQuXG4gICAgLy8gS2V5IGlzIE1lZGlhU3RyZWFtJ3MgSUQsIHZhbHVlIGlzIGFuIG9iamVjdCB7c291cmNlOnthdWRpbzpzdHJpbmcsIHZpZGVvOnN0cmluZ30sIGF0dHJpYnV0ZXM6IG9iamVjdCwgc3RyZWFtOiBSZW1vdGVTdHJlYW0sIG1lZGlhU3RyZWFtOiBNZWRpYVN0cmVhbX0uIGBzdHJlYW1gIGFuZCBgbWVkaWFTdHJlYW1gIHdpbGwgYmUgc2V0IHdoZW4gYHRyYWNrYCBldmVudCBpcyBmaXJlZCBvbiBgUlRDUGVlckNvbm5lY3Rpb25gLiBgbWVkaWFTdHJlYW1gIHdpbGwgYmUgYG51bGxgIGFmdGVyIGBzdHJlYW1hZGRlZGAgZXZlbnQgaXMgZmlyZWQgb24gYFAyUENsaWVudGAuIE90aGVyIHByb3BlcnRlcyB3aWxsIGJlIHNldCB1cG9uIGBTVFJFQU1fSU5GT2AgZXZlbnQgZnJvbSBzaWduYWxpbmcgY2hhbm5lbC5cbiAgICB0aGlzLl9yZW1vdGVTdHJlYW1JbmZvID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuX3JlbW90ZVN0cmVhbXMgPSBbXTtcbiAgICB0aGlzLl9yZW1vdGVUcmFja1NvdXJjZUluZm8gPSBuZXcgTWFwKCk7IC8vIEtleSBpcyBNZWRpYVN0cmVhbVRyYWNrJ3MgSUQsIHZhbHVlIGlzIHNvdXJjZSBpbmZvLlxuICAgIHRoaXMuX3B1Ymxpc2hQcm9taXNlcyA9IG5ldyBNYXAoKTsgLy8gS2V5IGlzIE1lZGlhU3RyZWFtJ3MgSUQsIHZhbHVlIGlzIGFuIG9iamVjdCBoYXMgfHJlc29sdmV8IGFuZCB8cmVqZWN0fC5cbiAgICB0aGlzLl91bnB1Ymxpc2hQcm9taXNlcyA9IG5ldyBNYXAoKTsgLy8gS2V5IGlzIE1lZGlhU3RyZWFtJ3MgSUQsIHZhbHVlIGlzIGFuIG9iamVjdCBoYXMgfHJlc29sdmV8IGFuZCB8cmVqZWN0fC5cbiAgICB0aGlzLl9wdWJsaXNoaW5nU3RyZWFtVHJhY2tzID0gbmV3IE1hcCgpOyAvLyBLZXkgaXMgTWVkaWFTdHJlYW0ncyBJRCwgdmFsdWUgaXMgYW4gYXJyYXkgb2YgdGhlIElEIG9mIGl0cyBNZWRpYVN0cmVhbVRyYWNrcyB0aGF0IGhhdmVuJ3QgYmVlbiBhY2tlZC5cbiAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1UcmFja3MgPSBuZXcgTWFwKCk7IC8vIEtleSBpcyBNZWRpYVN0cmVhbSdzIElELCB2YWx1ZSBpcyBhbiBhcnJheSBvZiB0aGUgSUQgb2YgaXRzIE1lZGlhU3RyZWFtVHJhY2tzIHRoYXQgaGF2ZW4ndCBiZWVuIHJlbW92ZWQuXG4gICAgdGhpcy5faXNOZWdvdGlhdGlvbk5lZWRlZCA9IGZhbHNlO1xuICAgIHRoaXMuX3JlbW90ZVNpZGVTdXBwb3J0c1JlbW92ZVN0cmVhbSA9IHRydWU7XG4gICAgdGhpcy5fcmVtb3RlU2lkZVN1cHBvcnRzUGxhbkIgPSB0cnVlO1xuICAgIHRoaXMuX3JlbW90ZVNpZGVTdXBwb3J0c1VuaWZpZWRQbGFuID0gdHJ1ZTtcbiAgICB0aGlzLl9yZW1vdGVJY2VDYW5kaWRhdGVzID0gW107XG4gICAgdGhpcy5fZGF0YUNoYW5uZWxzID0gbmV3IE1hcCgpOyAvLyBLZXkgaXMgZGF0YSBjaGFubmVsJ3MgbGFiZWwsIHZhbHVlIGlzIGEgUlRDRGF0YUNoYW5uZWwuXG4gICAgdGhpcy5fcGVuZGluZ01lc3NhZ2VzID0gW107XG4gICAgdGhpcy5fZGF0YVNlcSA9IDE7IC8vIFNlcXVlbmNlIG51bWJlciBmb3IgZGF0YSBjaGFubmVsIG1lc3NhZ2VzLlxuICAgIHRoaXMuX3NlbmREYXRhUHJvbWlzZXMgPSBuZXcgTWFwKCk7IC8vIEtleSBpcyBkYXRhIHNlcXVlbmNlIG51bWJlciwgdmFsdWUgaXMgYW4gb2JqZWN0IGhhcyB8cmVzb2x2ZXwgYW5kIHxyZWplY3R8LlxuICAgIHRoaXMuX2FkZGVkVHJhY2tJZHMgPSBbXTsgLy8gVHJhY2tzIHRoYXQgaGF2ZSBiZWVuIGFkZGVkIGFmdGVyIHJlY2VpdmluZyByZW1vdGUgU0RQIGJ1dCBiZWZvcmUgY29ubmVjdGlvbiBpcyBlc3RhYmxpc2hlZC4gRHJhaW5pbmcgdGhlc2UgbWVzc2FnZXMgd2hlbiBJQ0UgY29ubmVjdGlvbiBzdGF0ZSBpcyBjb25uZWN0ZWQuXG4gICAgdGhpcy5faXNDYWxsZXIgPSB0cnVlO1xuICAgIHRoaXMuX2luZm9TZW50ID0gZmFsc2U7XG4gICAgdGhpcy5fZGlzcG9zZWQgPSBmYWxzZTtcbiAgICB0aGlzLl9jcmVhdGVQZWVyQ29ubmVjdGlvbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBwdWJsaXNoXG4gICAqIEBkZXNjIFB1Ymxpc2ggYSBzdHJlYW0gdG8gdGhlIHJlbW90ZSBlbmRwb2ludC5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIHB1Ymxpc2goc3RyZWFtKSB7XG4gICAgaWYgKCEoc3RyZWFtIGluc3RhbmNlb2YgU3RyZWFtTW9kdWxlLkxvY2FsU3RyZWFtKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgc3RyZWFtLicpKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuX3B1Ymxpc2hlZFN0cmVhbXMuaGFzKHN0cmVhbSkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSUxMRUdBTF9BUkdVTUVOVCxcbiAgICAgICAgICAnRHVwbGljYXRlZCBzdHJlYW0uJykpO1xuICAgIH1cbiAgICBpZiAodGhpcy5fYXJlQWxsVHJhY2tzRW5kZWQoc3RyZWFtLm1lZGlhU3RyZWFtKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvck1vZHVsZS5QMlBFcnJvcihcbiAgICAgICAgICBFcnJvck1vZHVsZS5lcnJvcnMuUDJQX0NMSUVOVF9JTlZBTElEX1NUQVRFLFxuICAgICAgICAgICdBbGwgdHJhY2tzIGFyZSBlbmRlZC4nKSk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLmFsbChbdGhpcy5fc2VuZENsb3NlZE1zZ0lmTmVjZXNzYXJ5KCksXG4gICAgICB0aGlzLl9zZW5kU3lzSW5mb0lmTmVjZXNzYXJ5KCksXG4gICAgICB0aGlzLl9zZW5kU3RyZWFtSW5mbyhzdHJlYW0pXSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAvLyBSZXBsYWNlIHxhZGRTdHJlYW18IHdpdGggUGVlckNvbm5lY3Rpb24uYWRkVHJhY2sgd2hlbiBhbGwgYnJvd3NlcnMgYXJlIHJlYWR5LlxuICAgICAgICBmb3IgKGNvbnN0IHRyYWNrIG9mIHN0cmVhbS5tZWRpYVN0cmVhbS5nZXRUcmFja3MoKSkge1xuICAgICAgICAgIHRoaXMuX3BjLmFkZFRyYWNrKHRyYWNrLCBzdHJlYW0ubWVkaWFTdHJlYW0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX29uTmVnb3RpYXRpb25uZWVkZWQoKTtcbiAgICAgICAgdGhpcy5fcHVibGlzaGluZ1N0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICBjb25zdCB0cmFja0lkcyA9IEFycmF5LmZyb20oc3RyZWFtLm1lZGlhU3RyZWFtLmdldFRyYWNrcygpLFxuICAgICAgICAgICAgKHRyYWNrKSA9PiB0cmFjay5pZCk7XG4gICAgICAgIHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1UcmFja3Muc2V0KHN0cmVhbS5tZWRpYVN0cmVhbS5pZCxcbiAgICAgICAgICAgIHRyYWNrSWRzKTtcbiAgICAgICAgdGhpcy5fcHVibGlzaFByb21pc2VzLnNldChzdHJlYW0ubWVkaWFTdHJlYW0uaWQsIHtcbiAgICAgICAgICByZXNvbHZlOiByZXNvbHZlLFxuICAgICAgICAgIHJlamVjdDogcmVqZWN0LFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBzZW5kXG4gICAqIEBkZXNjIFNlbmQgYSBtZXNzYWdlIHRvIHRoZSByZW1vdGUgZW5kcG9pbnQuXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBzZW5kKG1lc3NhZ2UpIHtcbiAgICBpZiAoISh0eXBlb2YgbWVzc2FnZSA9PT0gJ3N0cmluZycpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignSW52YWxpZCBtZXNzYWdlLicpKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHtcbiAgICAgIGlkOiB0aGlzLl9kYXRhU2VxKyssXG4gICAgICBkYXRhOiBtZXNzYWdlLFxuICAgIH07XG4gICAgY29uc3QgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuX3NlbmREYXRhUHJvbWlzZXMuc2V0KGRhdGEuaWQsIHtcbiAgICAgICAgcmVzb2x2ZTogcmVzb2x2ZSxcbiAgICAgICAgcmVqZWN0OiByZWplY3QsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBpZiAoIXRoaXMuX2RhdGFDaGFubmVscy5oYXMoRGF0YUNoYW5uZWxMYWJlbC5NRVNTQUdFKSkge1xuICAgICAgdGhpcy5fY3JlYXRlRGF0YUNoYW5uZWwoRGF0YUNoYW5uZWxMYWJlbC5NRVNTQUdFKTtcbiAgICB9XG5cbiAgICB0aGlzLl9zZW5kQ2xvc2VkTXNnSWZOZWNlc3NhcnkoKS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBMb2dnZXIuZGVidWcoJ0ZhaWxlZCB0byBzZW5kIGNsb3NlZCBtZXNzYWdlLicgKyBlcnIubWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9zZW5kU3lzSW5mb0lmTmVjZXNzYXJ5KCkuY2F0Y2goKGVycikgPT4ge1xuICAgICAgTG9nZ2VyLmRlYnVnKCdGYWlsZWQgdG8gc2VuZCBzeXNJbmZvLicgKyBlcnIubWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBkYyA9IHRoaXMuX2RhdGFDaGFubmVscy5nZXQoRGF0YUNoYW5uZWxMYWJlbC5NRVNTQUdFKTtcbiAgICBpZiAoZGMucmVhZHlTdGF0ZSA9PT0gJ29wZW4nKSB7XG4gICAgICB0aGlzLl9kYXRhQ2hhbm5lbHMuZ2V0KERhdGFDaGFubmVsTGFiZWwuTUVTU0FHRSkuc2VuZChcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkYXRhKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdNZXNzYWdlcy5wdXNoKGRhdGEpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAZnVuY3Rpb24gc3RvcFxuICAgKiBAZGVzYyBTdG9wIHRoZSBjb25uZWN0aW9uIHdpdGggcmVtb3RlIGVuZHBvaW50LlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICB0aGlzLl9zdG9wKHVuZGVmaW5lZCwgdHJ1ZSk7XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIGdldFN0YXRzXG4gICAqIEBkZXNjIEdldCBzdGF0cyBmb3IgYSBzcGVjaWZpYyBNZWRpYVN0cmVhbS5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIGdldFN0YXRzKG1lZGlhU3RyZWFtKSB7XG4gICAgaWYgKHRoaXMuX3BjKSB7XG4gICAgICBpZiAobWVkaWFTdHJlYW0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcGMuZ2V0U3RhdHMoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHRyYWNrc1N0YXRzUmVwb3J0cyA9IFtdO1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5hbGwoW21lZGlhU3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goKHRyYWNrKSA9PiB7XG4gICAgICAgICAgdGhpcy5fZ2V0U3RhdHModHJhY2ssIHRyYWNrc1N0YXRzUmVwb3J0cyk7XG4gICAgICAgIH0pXSkudGhlbihcbiAgICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKHRyYWNrc1N0YXRzUmVwb3J0cyk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoXG4gICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSU5WQUxJRF9TVEFURSkpO1xuICAgIH1cbiAgfVxuXG4gIF9nZXRTdGF0cyhtZWRpYVN0cmVhbVRyYWNrLCByZXBvcnRzUmVzdWx0KSB7XG4gICAgcmV0dXJuIHRoaXMuX3BjLmdldFN0YXRzKG1lZGlhU3RyZWFtVHJhY2spLnRoZW4oXG4gICAgICAgIChzdGF0c1JlcG9ydCkgPT4ge1xuICAgICAgICAgIHJlcG9ydHNSZXN1bHQucHVzaChzdGF0c1JlcG9ydCk7XG4gICAgICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBvbk1lc3NhZ2VcbiAgICogQGRlc2MgVGhpcyBtZXRob2QgaXMgY2FsbGVkIGJ5IFAyUENsaWVudCB3aGVuIHRoZXJlIGlzIG5ldyBzaWduYWxpbmcgbWVzc2FnZSBhcnJpdmVkLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICB0aGlzLl9TaWduYWxpbmdNZXNzc2FnZUhhbmRsZXIobWVzc2FnZSk7XG4gIH1cblxuICBfc2VuZFNkcChzZHApIHtcbiAgICByZXR1cm4gdGhpcy5fc2lnbmFsaW5nLnNlbmRTaWduYWxpbmdNZXNzYWdlKFxuICAgICAgICB0aGlzLl9yZW1vdGVJZCwgU2lnbmFsaW5nVHlwZS5TRFAsIHNkcCk7XG4gIH1cblxuICBfc2VuZFNpZ25hbGluZ01lc3NhZ2UodHlwZSwgbWVzc2FnZSkge1xuICAgIHJldHVybiB0aGlzLl9zaWduYWxpbmcuc2VuZFNpZ25hbGluZ01lc3NhZ2UodGhpcy5fcmVtb3RlSWQsIHR5cGUsIG1lc3NhZ2UpO1xuICB9XG5cbiAgX1NpZ25hbGluZ01lc3NzYWdlSGFuZGxlcihtZXNzYWdlKSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdDaGFubmVsIHJlY2VpdmVkIG1lc3NhZ2U6ICcgKyBtZXNzYWdlKTtcbiAgICBzd2l0Y2ggKG1lc3NhZ2UudHlwZSkge1xuICAgICAgY2FzZSBTaWduYWxpbmdUeXBlLlVBOlxuICAgICAgICB0aGlzLl9oYW5kbGVSZW1vdGVDYXBhYmlsaXR5KG1lc3NhZ2UuZGF0YSk7XG4gICAgICAgIHRoaXMuX3NlbmRTeXNJbmZvSWZOZWNlc3NhcnkoKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFNpZ25hbGluZ1R5cGUuVFJBQ0tfU09VUkNFUzpcbiAgICAgICAgdGhpcy5fdHJhY2tTb3VyY2VzSGFuZGxlcihtZXNzYWdlLmRhdGEpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgU2lnbmFsaW5nVHlwZS5TVFJFQU1fSU5GTzpcbiAgICAgICAgdGhpcy5fc3RyZWFtSW5mb0hhbmRsZXIobWVzc2FnZS5kYXRhKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFNpZ25hbGluZ1R5cGUuU0RQOlxuICAgICAgICB0aGlzLl9zZHBIYW5kbGVyKG1lc3NhZ2UuZGF0YSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBTaWduYWxpbmdUeXBlLlRSQUNLU19BRERFRDpcbiAgICAgICAgdGhpcy5fdHJhY2tzQWRkZWRIYW5kbGVyKG1lc3NhZ2UuZGF0YSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBTaWduYWxpbmdUeXBlLlRSQUNLU19SRU1PVkVEOlxuICAgICAgICB0aGlzLl90cmFja3NSZW1vdmVkSGFuZGxlcihtZXNzYWdlLmRhdGEpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgU2lnbmFsaW5nVHlwZS5EQVRBX1JFQ0VJVkVEOlxuICAgICAgICB0aGlzLl9kYXRhUmVjZWl2ZWRIYW5kbGVyKG1lc3NhZ2UuZGF0YSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBTaWduYWxpbmdUeXBlLkNMT1NFRDpcbiAgICAgICAgdGhpcy5fY2hhdENsb3NlZEhhbmRsZXIobWVzc2FnZS5kYXRhKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBMb2dnZXIuZXJyb3IoJ0ludmFsaWQgc2lnbmFsaW5nIG1lc3NhZ2UgcmVjZWl2ZWQuIFR5cGU6ICcgK1xuICAgICAgICAgICAgbWVzc2FnZS50eXBlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF90cmFja3NBZGRlZEhhbmRsZXJcbiAgICogQGRlc2MgSGFuZGxlIHRyYWNrIGFkZGVkIGV2ZW50IGZyb20gcmVtb3RlIHNpZGUuXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBfdHJhY2tzQWRkZWRIYW5kbGVyKGlkcykge1xuICAgIC8vIEN1cnJlbnRseSwgfGlkc3wgY29udGFpbnMgYWxsIHRyYWNrIElEcyBvZiBhIE1lZGlhU3RyZWFtLiBGb2xsb3dpbmcgYWxnb3JpdGhtIGFsc28gaGFuZGxlcyB8aWRzfCBpcyBhIHBhcnQgb2YgYSBNZWRpYVN0cmVhbSdzIHRyYWNrcy5cbiAgICBmb3IgKGNvbnN0IGlkIG9mIGlkcykge1xuICAgICAgLy8gSXQgY291bGQgYmUgYSBwcm9ibGVtIGlmIHRoZXJlIGlzIGEgdHJhY2sgcHVibGlzaGVkIHdpdGggZGlmZmVyZW50IE1lZGlhU3RyZWFtcy5cbiAgICAgIHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1UcmFja3MuZm9yRWFjaCgobWVkaWFUcmFja0lkcywgbWVkaWFTdHJlYW1JZCkgPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1lZGlhVHJhY2tJZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBpZiAobWVkaWFUcmFja0lkc1tpXSA9PT0gaWQpIHtcbiAgICAgICAgICAgIC8vIE1vdmUgdGhpcyB0cmFjayBmcm9tIHB1Ymxpc2hpbmcgdHJhY2tzIHRvIHB1Ymxpc2hlZCB0cmFja3MuXG4gICAgICAgICAgICBpZiAoIXRoaXMuX3B1Ymxpc2hlZFN0cmVhbVRyYWNrcy5oYXMobWVkaWFTdHJlYW1JZCkpIHtcbiAgICAgICAgICAgICAgdGhpcy5fcHVibGlzaGVkU3RyZWFtVHJhY2tzLnNldChtZWRpYVN0cmVhbUlkLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1UcmFja3MuZ2V0KG1lZGlhU3RyZWFtSWQpLnB1c2goXG4gICAgICAgICAgICAgICAgbWVkaWFUcmFja0lkc1tpXSk7XG4gICAgICAgICAgICBtZWRpYVRyYWNrSWRzLnNwbGljZShpLCAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gUmVzb2x2aW5nIGNlcnRhaW4gcHVibGlzaCBwcm9taXNlIHdoZW4gcmVtb3RlIGVuZHBvaW50IHJlY2VpdmVkIGFsbCB0cmFja3Mgb2YgYSBNZWRpYVN0cmVhbS5cbiAgICAgICAgICBpZiAobWVkaWFUcmFja0lkcy5sZW5ndGggPT0gMCkge1xuICAgICAgICAgICAgaWYgKCF0aGlzLl9wdWJsaXNoUHJvbWlzZXMuaGFzKG1lZGlhU3RyZWFtSWQpKSB7XG4gICAgICAgICAgICAgIExvZ2dlci53YXJuaW5nKCdDYW5ub3QgZmluZCB0aGUgcHJvbWlzZSBmb3IgcHVibGlzaGluZyAnICtcbiAgICAgICAgICAgICAgICBtZWRpYVN0cmVhbUlkKTtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRTdHJlYW1JbmRleCA9IHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1zLmZpbmRJbmRleChcbiAgICAgICAgICAgICAgICAoZWxlbWVudCkgPT4gZWxlbWVudC5tZWRpYVN0cmVhbS5pZCA9PSBtZWRpYVN0cmVhbUlkKTtcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldFN0cmVhbSA9IHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1zW3RhcmdldFN0cmVhbUluZGV4XTtcbiAgICAgICAgICAgIHRoaXMuX3B1Ymxpc2hpbmdTdHJlYW1zLnNwbGljZSh0YXJnZXRTdHJlYW1JbmRleCwgMSk7XG4gICAgICAgICAgICBjb25zdCBwdWJsaWNhdGlvbiA9IG5ldyBQdWJsaWNhdGlvbihcbiAgICAgICAgICAgICAgICBpZCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5fdW5wdWJsaXNoKHRhcmdldFN0cmVhbSkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHB1YmxpY2F0aW9uLmRpc3BhdGNoRXZlbnQobmV3IE93dEV2ZW50KCdlbmRlZCcpKTtcbiAgICAgICAgICAgICAgICAgIH0sIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIFVzZSBkZWJ1ZyBtb2RlIGJlY2F1c2UgdGhpcyBlcnJvciB1c3VhbGx5IGRvZXNuJ3QgYmxvY2sgc3RvcHBpbmcgYSBwdWJsaWNhdGlvbi5cbiAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICAgICAgJ1NvbWV0aGluZyB3cm9uZyBoYXBwZW5lZCBkdXJpbmcgc3RvcHBpbmcgYSAnK1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3B1YmxpY2F0aW9uLiAnICsgZXJyLm1lc3NhZ2UpO1xuICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKCF0YXJnZXRTdHJlYW0gfHwgIXRhcmdldFN0cmVhbS5tZWRpYVN0cmVhbSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yTW9kdWxlLlAyUEVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSU5WQUxJRF9TVEFURSxcbiAgICAgICAgICAgICAgICAgICAgICAgICdQdWJsaWNhdGlvbiBpcyBub3QgYXZhaWxhYmxlLicpKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFN0YXRzKHRhcmdldFN0cmVhbS5tZWRpYVN0cmVhbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1zLnNldCh0YXJnZXRTdHJlYW0sIHB1YmxpY2F0aW9uKTtcbiAgICAgICAgICAgIHRoaXMuX3B1Ymxpc2hQcm9taXNlcy5nZXQobWVkaWFTdHJlYW1JZCkucmVzb2x2ZShwdWJsaWNhdGlvbik7XG4gICAgICAgICAgICB0aGlzLl9wdWJsaXNoUHJvbWlzZXMuZGVsZXRlKG1lZGlhU3RyZWFtSWQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBfdHJhY2tzUmVtb3ZlZEhhbmRsZXJcbiAgICogQGRlc2MgSGFuZGxlIHRyYWNrIHJlbW92ZWQgZXZlbnQgZnJvbSByZW1vdGUgc2lkZS5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIF90cmFja3NSZW1vdmVkSGFuZGxlcihpZHMpIHtcbiAgICAvLyBDdXJyZW50bHksIHxpZHN8IGNvbnRhaW5zIGFsbCB0cmFjayBJRHMgb2YgYSBNZWRpYVN0cmVhbS4gRm9sbG93aW5nIGFsZ29yaXRobSBhbHNvIGhhbmRsZXMgfGlkc3wgaXMgYSBwYXJ0IG9mIGEgTWVkaWFTdHJlYW0ncyB0cmFja3MuXG4gICAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICAgIC8vIEl0IGNvdWxkIGJlIGEgcHJvYmxlbSBpZiB0aGVyZSBpcyBhIHRyYWNrIHB1Ymxpc2hlZCB3aXRoIGRpZmZlcmVudCBNZWRpYVN0cmVhbXMuXG4gICAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1UcmFja3MuZm9yRWFjaCgobWVkaWFUcmFja0lkcywgbWVkaWFTdHJlYW1JZCkgPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1lZGlhVHJhY2tJZHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBpZiAobWVkaWFUcmFja0lkc1tpXSA9PT0gaWQpIHtcbiAgICAgICAgICAgIG1lZGlhVHJhY2tJZHMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBmdW5jdGlvbiBfZGF0YVJlY2VpdmVkSGFuZGxlclxuICAgKiBAZGVzYyBIYW5kbGUgZGF0YSByZWNlaXZlZCBldmVudCBmcm9tIHJlbW90ZSBzaWRlLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgX2RhdGFSZWNlaXZlZEhhbmRsZXIoaWQpIHtcbiAgICBpZiAoIXRoaXMuX3NlbmREYXRhUHJvbWlzZXMuaGFzKGlkKSkge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ1JlY2VpdmVkIHVua25vd24gZGF0YSByZWNlaXZlZCBtZXNzYWdlLiBJRDogJyArIGlkKTtcbiAgICAgIHJldHVybjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fc2VuZERhdGFQcm9taXNlcy5nZXQoaWQpLnJlc29sdmUoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF9zZHBIYW5kbGVyXG4gICAqIEBkZXNjIEhhbmRsZSBTRFAgcmVjZWl2ZWQgZXZlbnQgZnJvbSByZW1vdGUgc2lkZS5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIF9zZHBIYW5kbGVyKHNkcCkge1xuICAgIGlmIChzZHAudHlwZSA9PT0gJ29mZmVyJykge1xuICAgICAgdGhpcy5fb25PZmZlcihzZHApO1xuICAgIH0gZWxzZSBpZiAoc2RwLnR5cGUgPT09ICdhbnN3ZXInKSB7XG4gICAgICB0aGlzLl9vbkFuc3dlcihzZHApO1xuICAgIH0gZWxzZSBpZiAoc2RwLnR5cGUgPT09ICdjYW5kaWRhdGVzJykge1xuICAgICAgdGhpcy5fb25SZW1vdGVJY2VDYW5kaWRhdGUoc2RwKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF90cmFja1NvdXJjZXNIYW5kbGVyXG4gICAqIEBkZXNjIFJlY2VpdmVkIHRyYWNrIHNvdXJjZSBpbmZvcm1hdGlvbiBmcm9tIHJlbW90ZSBzaWRlLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgX3RyYWNrU291cmNlc0hhbmRsZXIoZGF0YSkge1xuICAgIGZvciAoY29uc3QgaW5mbyBvZiBkYXRhKSB7XG4gICAgICB0aGlzLl9yZW1vdGVUcmFja1NvdXJjZUluZm8uc2V0KGluZm8uaWQsIGluZm8uc291cmNlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF9zdHJlYW1JbmZvSGFuZGxlclxuICAgKiBAZGVzYyBSZWNlaXZlZCBzdHJlYW0gaW5mb3JtYXRpb24gZnJvbSByZW1vdGUgc2lkZS5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIF9zdHJlYW1JbmZvSGFuZGxlcihkYXRhKSB7XG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICBMb2dnZXIud2FybmluZygnVW5leHBlY3RlZCBzdHJlYW0gaW5mby4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5fcmVtb3RlU3RyZWFtSW5mby5zZXQoZGF0YS5pZCwge1xuICAgICAgc291cmNlOiBkYXRhLnNvdXJjZSxcbiAgICAgIGF0dHJpYnV0ZXM6IGRhdGEuYXR0cmlidXRlcyxcbiAgICAgIHN0cmVhbTogbnVsbCxcbiAgICAgIG1lZGlhU3RyZWFtOiBudWxsLFxuICAgICAgdHJhY2tJZHM6IGRhdGEudHJhY2tzLCAvLyBUcmFjayBJRHMgbWF5IG5vdCBtYXRjaCBhdCBzZW5kZXIgYW5kIHJlY2VpdmVyIHNpZGVzLiBLZWVwIGl0IGZvciBsZWdhY3kgcG9ycG9zZXMuXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQGZ1bmN0aW9uIF9jaGF0Q2xvc2VkSGFuZGxlclxuICAgKiBAZGVzYyBSZWNlaXZlZCBjaGF0IGNsb3NlZCBldmVudCBmcm9tIHJlbW90ZSBzaWRlLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgX2NoYXRDbG9zZWRIYW5kbGVyKGRhdGEpIHtcbiAgICB0aGlzLl9kaXNwb3NlZCA9IHRydWU7XG4gICAgdGhpcy5fc3RvcChkYXRhLCBmYWxzZSk7XG4gIH1cblxuICBfb25PZmZlcihzZHApIHtcbiAgICBMb2dnZXIuZGVidWcoJ0Fib3V0IHRvIHNldCByZW1vdGUgZGVzY3JpcHRpb24uIFNpZ25hbGluZyBzdGF0ZTogJyArXG4gICAgICB0aGlzLl9wYy5zaWduYWxpbmdTdGF0ZSk7XG4gICAgc2RwLnNkcCA9IHRoaXMuX3NldFJ0cFNlbmRlck9wdGlvbnMoc2RwLnNkcCwgdGhpcy5fY29uZmlnKTtcbiAgICAvLyBGaXJlZm94IG9ubHkgaGFzIG9uZSBjb2RlYyBpbiBhbnN3ZXIsIHdoaWNoIGRvZXMgbm90IHRydWx5IHJlZmxlY3QgaXRzXG4gICAgLy8gZGVjb2RpbmcgY2FwYWJpbGl0eS4gU28gd2Ugc2V0IGNvZGVjIHByZWZlcmVuY2UgdG8gcmVtb3RlIG9mZmVyLCBhbmQgbGV0XG4gICAgLy8gRmlyZWZveCBjaG9vc2UgaXRzIHByZWZlcnJlZCBjb2RlYy5cbiAgICAvLyBSZWZlcmVuY2U6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTgxNDIyNy5cbiAgICBpZiAoVXRpbHMuaXNGaXJlZm94KCkpIHtcbiAgICAgIHNkcC5zZHAgPSB0aGlzLl9zZXRDb2RlY09yZGVyKHNkcC5zZHApO1xuICAgIH1cbiAgICBjb25zdCBzZXNzaW9uRGVzY3JpcHRpb24gPSBuZXcgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKHNkcCk7XG4gICAgdGhpcy5fcGMuc2V0UmVtb3RlRGVzY3JpcHRpb24oc2Vzc2lvbkRlc2NyaXB0aW9uKS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX2NyZWF0ZUFuZFNlbmRBbnN3ZXIoKTtcbiAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnU2V0IHJlbW90ZSBkZXNjcmlwdGlvbiBmYWlsZWQuIE1lc3NhZ2U6ICcgKyBlcnJvci5tZXNzYWdlKTtcbiAgICAgIHRoaXMuX3N0b3AoZXJyb3IsIHRydWUpO1xuICAgIH0pO1xuICB9XG5cbiAgX29uQW5zd2VyKHNkcCkge1xuICAgIExvZ2dlci5kZWJ1ZygnQWJvdXQgdG8gc2V0IHJlbW90ZSBkZXNjcmlwdGlvbi4gU2lnbmFsaW5nIHN0YXRlOiAnICtcbiAgICAgIHRoaXMuX3BjLnNpZ25hbGluZ1N0YXRlKTtcbiAgICBzZHAuc2RwID0gdGhpcy5fc2V0UnRwU2VuZGVyT3B0aW9ucyhzZHAuc2RwLCB0aGlzLl9jb25maWcpO1xuICAgIGNvbnN0IHNlc3Npb25EZXNjcmlwdGlvbiA9IG5ldyBSVENTZXNzaW9uRGVzY3JpcHRpb24oc2RwKTtcbiAgICB0aGlzLl9wYy5zZXRSZW1vdGVEZXNjcmlwdGlvbihuZXcgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKFxuICAgICAgICBzZXNzaW9uRGVzY3JpcHRpb24pKS50aGVuKCgpID0+IHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnU2V0IHJlbW90ZSBkZXNjcmlwaXRvbiBzdWNjZXNzZnVsbHkuJyk7XG4gICAgICB0aGlzLl9kcmFpblBlbmRpbmdNZXNzYWdlcygpO1xuICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgTG9nZ2VyLmRlYnVnKCdTZXQgcmVtb3RlIGRlc2NyaXB0aW9uIGZhaWxlZC4gTWVzc2FnZTogJyArIGVycm9yLm1lc3NhZ2UpO1xuICAgICAgdGhpcy5fc3RvcChlcnJvciwgdHJ1ZSk7XG4gICAgfSk7XG4gIH1cblxuICBfb25Mb2NhbEljZUNhbmRpZGF0ZShldmVudCkge1xuICAgIGlmIChldmVudC5jYW5kaWRhdGUpIHtcbiAgICAgIHRoaXMuX3NlbmRTZHAoe1xuICAgICAgICB0eXBlOiAnY2FuZGlkYXRlcycsXG4gICAgICAgIGNhbmRpZGF0ZTogZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSxcbiAgICAgICAgc2RwTWlkOiBldmVudC5jYW5kaWRhdGUuc2RwTWlkLFxuICAgICAgICBzZHBNTGluZUluZGV4OiBldmVudC5jYW5kaWRhdGUuc2RwTUxpbmVJbmRleCxcbiAgICAgIH0pLmNhdGNoKChlKT0+e1xuICAgICAgICBMb2dnZXIud2FybmluZygnRmFpbGVkIHRvIHNlbmQgY2FuZGlkYXRlLicpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnRW1wdHkgY2FuZGlkYXRlLicpO1xuICAgIH1cbiAgfVxuXG4gIF9vblJlbW90ZVRyYWNrQWRkZWQoZXZlbnQpIHtcbiAgICBMb2dnZXIuZGVidWcoJ1JlbW90ZSB0cmFjayBhZGRlZC4nKTtcbiAgICBmb3IgKGNvbnN0IHN0cmVhbSBvZiBldmVudC5zdHJlYW1zKSB7XG4gICAgICBpZiAoIXRoaXMuX3JlbW90ZVN0cmVhbUluZm8uaGFzKHN0cmVhbS5pZCkpIHtcbiAgICAgICAgTG9nZ2VyLndhcm5pbmcoJ01pc3Npbmcgc3RyZWFtIGluZm8uJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5fcmVtb3RlU3RyZWFtSW5mby5nZXQoc3RyZWFtLmlkKS5zdHJlYW0pIHtcbiAgICAgICAgdGhpcy5fc2V0U3RyZWFtVG9SZW1vdGVTdHJlYW1JbmZvKHN0cmVhbSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0aGlzLl9wYy5pY2VDb25uZWN0aW9uU3RhdGUgPT09ICdjb25uZWN0ZWQnIHx8XG4gICAgICAgdGhpcy5fcGMuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnY29tcGxldGVkJykge1xuICAgICAgdGhpcy5fY2hlY2tJY2VDb25uZWN0aW9uU3RhdGVBbmRGaXJlRXZlbnQoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fYWRkZWRUcmFja0lkcy5jb25jYXQoZXZlbnQudHJhY2suaWQpO1xuICAgIH1cbiAgfVxuXG4gIF9vblJlbW90ZVN0cmVhbUFkZGVkKGV2ZW50KSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdSZW1vdGUgc3RyZWFtIGFkZGVkLicpO1xuICAgIGlmICghdGhpcy5fcmVtb3RlU3RyZWFtSW5mby5oYXMoZXZlbnQuc3RyZWFtLmlkKSkge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ0Nhbm5vdCBmaW5kIHNvdXJjZSBpbmZvIGZvciBzdHJlYW0gJyArIGV2ZW50LnN0cmVhbS5pZCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLl9wYy5pY2VDb25uZWN0aW9uU3RhdGUgPT09ICdjb25uZWN0ZWQnIHx8XG4gICAgICB0aGlzLl9wYy5pY2VDb25uZWN0aW9uU3RhdGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgICB0aGlzLl9zZW5kU2lnbmFsaW5nTWVzc2FnZShTaWduYWxpbmdUeXBlLlRSQUNLU19BRERFRCxcbiAgICAgICAgICB0aGlzLl9yZW1vdGVTdHJlYW1JbmZvLmdldChldmVudC5zdHJlYW0uaWQpLnRyYWNrSWRzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fYWRkZWRUcmFja0lkcyA9IHRoaXMuX2FkZGVkVHJhY2tJZHMuY29uY2F0KFxuICAgICAgICAgIHRoaXMuX3JlbW90ZVN0cmVhbUluZm8uZ2V0KGV2ZW50LnN0cmVhbS5pZCkudHJhY2tJZHMpO1xuICAgIH1cbiAgICBjb25zdCBhdWRpb1RyYWNrU291cmNlID0gdGhpcy5fcmVtb3RlU3RyZWFtSW5mby5nZXQoZXZlbnQuc3RyZWFtLmlkKVxuICAgICAgICAuc291cmNlLmF1ZGlvO1xuICAgIGNvbnN0IHZpZGVvVHJhY2tTb3VyY2UgPSB0aGlzLl9yZW1vdGVTdHJlYW1JbmZvLmdldChldmVudC5zdHJlYW0uaWQpXG4gICAgICAgIC5zb3VyY2UudmlkZW87XG4gICAgY29uc3Qgc291cmNlSW5mbyA9IG5ldyBTdHJlYW1Nb2R1bGUuU3RyZWFtU291cmNlSW5mbyhhdWRpb1RyYWNrU291cmNlLFxuICAgICAgICB2aWRlb1RyYWNrU291cmNlKTtcbiAgICBpZiAoVXRpbHMuaXNTYWZhcmkoKSkge1xuICAgICAgaWYgKCFzb3VyY2VJbmZvLmF1ZGlvKSB7XG4gICAgICAgIGV2ZW50LnN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmZvckVhY2goKHRyYWNrKSA9PiB7XG4gICAgICAgICAgZXZlbnQuc3RyZWFtLnJlbW92ZVRyYWNrKHRyYWNrKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIXNvdXJjZUluZm8udmlkZW8pIHtcbiAgICAgICAgZXZlbnQuc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkuZm9yRWFjaCgodHJhY2spID0+IHtcbiAgICAgICAgICBldmVudC5zdHJlYW0ucmVtb3ZlVHJhY2sodHJhY2spO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuX3JlbW90ZVN0cmVhbUluZm8uZ2V0KGV2ZW50LnN0cmVhbS5pZCkuYXR0cmlidXRlcztcbiAgICBjb25zdCBzdHJlYW0gPSBuZXcgU3RyZWFtTW9kdWxlLlJlbW90ZVN0cmVhbSh1bmRlZmluZWQsIHRoaXMuX3JlbW90ZUlkLFxuICAgICAgICBldmVudC5zdHJlYW0sIHNvdXJjZUluZm8sIGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzdHJlYW0pIHtcbiAgICAgIHRoaXMuX3JlbW90ZVN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgY29uc3Qgc3RyZWFtRXZlbnQgPSBuZXcgU3RyZWFtTW9kdWxlLlN0cmVhbUV2ZW50KCdzdHJlYW1hZGRlZCcsIHtcbiAgICAgICAgc3RyZWFtOiBzdHJlYW0sXG4gICAgICB9KTtcbiAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChzdHJlYW1FdmVudCk7XG4gICAgfVxuICB9XG5cbiAgX29uUmVtb3RlU3RyZWFtUmVtb3ZlZChldmVudCkge1xuICAgIExvZ2dlci5kZWJ1ZygnUmVtb3RlIHN0cmVhbSByZW1vdmVkLicpO1xuICAgIGNvbnN0IGkgPSB0aGlzLl9yZW1vdGVTdHJlYW1zLmZpbmRJbmRleCgocykgPT4ge1xuICAgICAgcmV0dXJuIHMubWVkaWFTdHJlYW0uaWQgPT09IGV2ZW50LnN0cmVhbS5pZDtcbiAgICB9KTtcbiAgICBpZiAoaSAhPT0gLTEpIHtcbiAgICAgIGNvbnN0IHN0cmVhbSA9IHRoaXMuX3JlbW90ZVN0cmVhbXNbaV07XG4gICAgICB0aGlzLl9zdHJlYW1SZW1vdmVkKHN0cmVhbSk7XG4gICAgICB0aGlzLl9yZW1vdGVTdHJlYW1zLnNwbGljZShpLCAxKTtcbiAgICB9XG4gIH1cblxuICBfb25OZWdvdGlhdGlvbm5lZWRlZCgpIHtcbiAgICAvLyBUaGlzIGlzIGludGVudGVkIHRvIGJlIGV4ZWN1dGVkIHdoZW4gb25uZWdvdGlhdGlvbm5lZWRlZCBldmVudCBpcyBmaXJlZC5cbiAgICAvLyBIb3dldmVyLCBvbm5lZ290aWF0aW9ubmVlZGVkIG1heSBmaXJlIG11dGlwbGUgdGltZXMgd2hlbiBtb3JlIHRoYW4gb25lXG4gICAgLy8gdHJhY2sgaXMgYWRkZWQvcmVtb3ZlZC4gU28gd2UgbWFudWFsbHkgZXhlY3V0ZSB0aGlzIGZ1bmN0aW9uIGFmdGVyXG4gICAgLy8gYWRkaW5nL3JlbW92aW5nIHRyYWNrIGFuZCBjcmVhdGluZyBkYXRhIGNoYW5uZWwuXG4gICAgTG9nZ2VyLmRlYnVnKCdPbiBuZWdvdGlhdGlvbiBuZWVkZWQuJyk7XG5cbiAgICBpZiAodGhpcy5fcGMuc2lnbmFsaW5nU3RhdGUgPT09ICdzdGFibGUnKSB7XG4gICAgICB0aGlzLl9kb05lZ290aWF0ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9pc05lZ290aWF0aW9uTmVlZGVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBfb25SZW1vdGVJY2VDYW5kaWRhdGUoY2FuZGlkYXRlSW5mbykge1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG5ldyBSVENJY2VDYW5kaWRhdGUoe1xuICAgICAgY2FuZGlkYXRlOiBjYW5kaWRhdGVJbmZvLmNhbmRpZGF0ZSxcbiAgICAgIHNkcE1pZDogY2FuZGlkYXRlSW5mby5zZHBNaWQsXG4gICAgICBzZHBNTGluZUluZGV4OiBjYW5kaWRhdGVJbmZvLnNkcE1MaW5lSW5kZXgsXG4gICAgfSk7XG4gICAgaWYgKHRoaXMuX3BjLnJlbW90ZURlc2NyaXB0aW9uICYmIHRoaXMuX3BjLnJlbW90ZURlc2NyaXB0aW9uLnNkcCAhPT0gJycpIHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnQWRkIHJlbW90ZSBpY2UgY2FuZGlkYXRlcy4nKTtcbiAgICAgIHRoaXMuX3BjLmFkZEljZUNhbmRpZGF0ZShjYW5kaWRhdGUpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBMb2dnZXIud2FybmluZygnRXJyb3IgcHJvY2Vzc2luZyBJQ0UgY2FuZGlkYXRlOiAnICsgZXJyb3IpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnQ2FjaGUgcmVtb3RlIGljZSBjYW5kaWRhdGVzLicpO1xuICAgICAgdGhpcy5fcmVtb3RlSWNlQ2FuZGlkYXRlcy5wdXNoKGNhbmRpZGF0ZSk7XG4gICAgfVxuICB9XG5cbiAgX29uU2lnbmFsaW5nU3RhdGVDaGFuZ2UoZXZlbnQpIHtcbiAgICBMb2dnZXIuZGVidWcoJ1NpZ25hbGluZyBzdGF0ZSBjaGFuZ2VkOiAnICsgdGhpcy5fcGMuc2lnbmFsaW5nU3RhdGUpO1xuICAgIGlmICh0aGlzLl9wYy5zaWduYWxpbmdTdGF0ZSA9PT0gJ2Nsb3NlZCcpIHtcbiAgICAgIC8vIHN0b3BDaGF0TG9jYWxseShwZWVyLCBwZWVyLmlkKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3BjLnNpZ25hbGluZ1N0YXRlID09PSAnc3RhYmxlJykge1xuICAgICAgdGhpcy5fbmVnb3RpYXRpbmcgPSBmYWxzZTtcbiAgICAgIGlmICh0aGlzLl9pc05lZ290aWF0aW9uTmVlZGVkKSB7XG4gICAgICAgIHRoaXMuX29uTmVnb3RpYXRpb25uZWVkZWQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX2RyYWluUGVuZGluZ1N0cmVhbXMoKTtcbiAgICAgICAgdGhpcy5fZHJhaW5QZW5kaW5nTWVzc2FnZXMoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX3BjLnNpZ25hbGluZ1N0YXRlID09PSAnaGF2ZS1yZW1vdGUtb2ZmZXInKSB7XG4gICAgICB0aGlzLl9kcmFpblBlbmRpbmdSZW1vdGVJY2VDYW5kaWRhdGVzKCk7XG4gICAgfVxuICB9XG5cbiAgX29uSWNlQ29ubmVjdGlvblN0YXRlQ2hhbmdlKGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50LmN1cnJlbnRUYXJnZXQuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnY2xvc2VkJyB8fFxuICAgICAgICBldmVudC5jdXJyZW50VGFyZ2V0LmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yTW9kdWxlLlAyUEVycm9yKFxuICAgICAgICAgIEVycm9yTW9kdWxlLmVycm9ycy5QMlBfV0VCUlRDX1VOS05PV04sXG4gICAgICAgICAgJ0lDRSBjb25uZWN0aW9uIGZhaWxlZCBvciBjbG9zZWQuJyk7XG4gICAgICB0aGlzLl9zdG9wKGVycm9yLCB0cnVlKTtcbiAgICB9IGVsc2UgaWYgKGV2ZW50LmN1cnJlbnRUYXJnZXQuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnY29ubmVjdGVkJyB8fFxuICAgICAgZXZlbnQuY3VycmVudFRhcmdldC5pY2VDb25uZWN0aW9uU3RhdGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgICB0aGlzLl9zZW5kU2lnbmFsaW5nTWVzc2FnZShTaWduYWxpbmdUeXBlLlRSQUNLU19BRERFRCxcbiAgICAgICAgICB0aGlzLl9hZGRlZFRyYWNrSWRzKTtcbiAgICAgIHRoaXMuX2FkZGVkVHJhY2tJZHMgPSBbXTtcbiAgICAgIHRoaXMuX2NoZWNrSWNlQ29ubmVjdGlvblN0YXRlQW5kRmlyZUV2ZW50KCk7XG4gICAgfVxuICB9XG5cbiAgX29uRGF0YUNoYW5uZWxNZXNzYWdlKGV2ZW50KSB7XG4gICAgY29uc3QgbWVzc2FnZT1KU09OLnBhcnNlKGV2ZW50LmRhdGEpO1xuICAgIExvZ2dlci5kZWJ1ZygnRGF0YSBjaGFubmVsIG1lc3NhZ2UgcmVjZWl2ZWQ6ICcrbWVzc2FnZS5kYXRhKTtcbiAgICB0aGlzLl9zZW5kU2lnbmFsaW5nTWVzc2FnZShTaWduYWxpbmdUeXBlLkRBVEFfUkVDRUlWRUQsIG1lc3NhZ2UuaWQpO1xuICAgIGNvbnN0IG1lc3NhZ2VFdmVudCA9IG5ldyBNZXNzYWdlRXZlbnQoJ21lc3NhZ2VyZWNlaXZlZCcsIHtcbiAgICAgIG1lc3NhZ2U6IG1lc3NhZ2UuZGF0YSxcbiAgICAgIG9yaWdpbjogdGhpcy5fcmVtb3RlSWQsXG4gICAgfSk7XG4gICAgdGhpcy5kaXNwYXRjaEV2ZW50KG1lc3NhZ2VFdmVudCk7XG4gIH1cblxuICBfb25EYXRhQ2hhbm5lbE9wZW4oZXZlbnQpIHtcbiAgICBMb2dnZXIuZGVidWcoJ0RhdGEgQ2hhbm5lbCBpcyBvcGVuZWQuJyk7XG4gICAgaWYgKGV2ZW50LnRhcmdldC5sYWJlbCA9PT0gRGF0YUNoYW5uZWxMYWJlbC5NRVNTQUdFKSB7XG4gICAgICBMb2dnZXIuZGVidWcoJ0RhdGEgY2hhbm5lbCBmb3IgbWVzc2FnZXMgaXMgb3BlbmVkLicpO1xuICAgICAgdGhpcy5fZHJhaW5QZW5kaW5nTWVzc2FnZXMoKTtcbiAgICB9XG4gIH1cblxuICBfb25EYXRhQ2hhbm5lbENsb3NlKGV2ZW50KSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdEYXRhIENoYW5uZWwgaXMgY2xvc2VkLicpO1xuICB9XG5cbiAgX3N0cmVhbVJlbW92ZWQoc3RyZWFtKSB7XG4gICAgaWYgKCF0aGlzLl9yZW1vdGVTdHJlYW1JbmZvLmhhcyhzdHJlYW0ubWVkaWFTdHJlYW0uaWQpKSB7XG4gICAgICBMb2dnZXIud2FybmluZygnQ2Fubm90IGZpbmQgc3RyZWFtIGluZm8uJyk7XG4gICAgfVxuICAgIHRoaXMuX3NlbmRTaWduYWxpbmdNZXNzYWdlKFNpZ25hbGluZ1R5cGUuVFJBQ0tTX1JFTU9WRUQsXG4gICAgICAgIHRoaXMuX3JlbW90ZVN0cmVhbUluZm8uZ2V0KHN0cmVhbS5tZWRpYVN0cmVhbS5pZCkudHJhY2tJZHMpO1xuICAgIGNvbnN0IGV2ZW50ID0gbmV3IE93dEV2ZW50KCdlbmRlZCcpO1xuICAgIHN0cmVhbS5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIF9pc1VuaWZpZWRQbGFuKCkge1xuICAgIGlmIChVdGlscy5pc0ZpcmVmb3goKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHBjID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKHtcbiAgICAgIHNkcFNlbWFudGljczogJ3VuaWZpZWQtcGxhbicsXG4gICAgfSk7XG4gICAgcmV0dXJuIChwYy5nZXRDb25maWd1cmF0aW9uKCkgJiYgcGMuZ2V0Q29uZmlndXJhdGlvbigpLnNkcFNlbWFudGljcyA9PT1cbiAgICAgICdwbGFuLWInKTtcbiAgfVxuXG4gIF9jcmVhdGVQZWVyQ29ubmVjdGlvbigpIHtcbiAgICBjb25zdCBwY0NvbmZpZ3VyYXRpb24gPSB0aGlzLl9jb25maWcucnRjQ29uZmlndXJhdGlvbiB8fCB7fTtcbiAgICBpZiAoVXRpbHMuaXNDaHJvbWUoKSkge1xuICAgICAgcGNDb25maWd1cmF0aW9uLnNkcFNlbWFudGljcyA9ICd1bmlmaWVkLXBsYW4nO1xuICAgIH1cbiAgICB0aGlzLl9wYyA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbihwY0NvbmZpZ3VyYXRpb24pO1xuICAgIC8vIEZpcmVmb3ggNTkgaW1wbGVtZW50ZWQgYWRkVHJhbnNjZWl2ZXIuIEhvd2V2ZXIsIG1pZCBpbiBTRFAgd2lsbCBkaWZmZXIgZnJvbSB0cmFjaydzIElEIGluIHRoaXMgY2FzZS4gQW5kIHRyYW5zY2VpdmVyJ3MgbWlkIGlzIG51bGwuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9wYy5hZGRUcmFuc2NlaXZlciA9PT0gJ2Z1bmN0aW9uJyAmJiBVdGlscy5pc1NhZmFyaSgpKSB7XG4gICAgICB0aGlzLl9wYy5hZGRUcmFuc2NlaXZlcignYXVkaW8nKTtcbiAgICAgIHRoaXMuX3BjLmFkZFRyYW5zY2VpdmVyKCd2aWRlbycpO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhcIndpbmRvdy5uYXZpZ2F0b3IudXNlckFnZW50LS0tLS0+XCIsd2luZG93Lm5hdmlnYXRvci51c2VyQWdlbnQpXG4gICAgY29uc29sZS5sb2coXCJVdGlscy5pc1NhZmFyaSgpLS0tLS0+XCIsVXRpbHMuaXNTYWZhcmkoKSlcbiAgICBpZiAoIXRoaXMuX2lzVW5pZmllZFBsYW4oKSAmJiAhVXRpbHMuaXNTYWZhcmkoKSAmJiAhVXRpbHMuaXNUYXVyaSgpKSB7XG4gICAgICB0aGlzLl9wYy5vbmFkZHN0cmVhbSA9IChldmVudCkgPT4ge1xuICAgICAgICAvLyBUT0RPOiBMZWdhY3kgQVBJLCBzaG91bGQgYmUgcmVtb3ZlZCB3aGVuIGFsbCBVQXMgaW1wbGVtZW50ZWQgV2ViUlRDIDEuMC5cbiAgICAgICAgdGhpcy5fb25SZW1vdGVTdHJlYW1BZGRlZC5hcHBseSh0aGlzLCBbZXZlbnRdKTtcbiAgICAgIH07XG4gICAgICB0aGlzLl9wYy5vbnJlbW92ZXN0cmVhbSA9IChldmVudCkgPT4ge1xuICAgICAgICB0aGlzLl9vblJlbW90ZVN0cmVhbVJlbW92ZWQuYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9wYy5vbnRyYWNrID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIHRoaXMuX29uUmVtb3RlVHJhY2tBZGRlZC5hcHBseSh0aGlzLCBbZXZlbnRdKTtcbiAgICAgIH07XG4gICAgfVxuICAgIHRoaXMuX3BjLm9uaWNlY2FuZGlkYXRlID0gKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLl9vbkxvY2FsSWNlQ2FuZGlkYXRlLmFwcGx5KHRoaXMsIFtldmVudF0pO1xuICAgIH07XG4gICAgdGhpcy5fcGMub25zaWduYWxpbmdzdGF0ZWNoYW5nZSA9IChldmVudCkgPT4ge1xuICAgICAgdGhpcy5fb25TaWduYWxpbmdTdGF0ZUNoYW5nZS5hcHBseSh0aGlzLCBbZXZlbnRdKTtcbiAgICB9O1xuICAgIHRoaXMuX3BjLm9uZGF0YWNoYW5uZWwgPSAoZXZlbnQpID0+IHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnT24gZGF0YSBjaGFubmVsLicpO1xuICAgICAgLy8gU2F2ZSByZW1vdGUgY3JlYXRlZCBkYXRhIGNoYW5uZWwuXG4gICAgICBpZiAoIXRoaXMuX2RhdGFDaGFubmVscy5oYXMoZXZlbnQuY2hhbm5lbC5sYWJlbCkpIHtcbiAgICAgICAgdGhpcy5fZGF0YUNoYW5uZWxzLnNldChldmVudC5jaGFubmVsLmxhYmVsLCBldmVudC5jaGFubmVsKTtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKCdTYXZlIHJlbW90ZSBjcmVhdGVkIGRhdGEgY2hhbm5lbC4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX2JpbmRFdmVudHNUb0RhdGFDaGFubmVsKGV2ZW50LmNoYW5uZWwpO1xuICAgIH07XG4gICAgdGhpcy5fcGMub25pY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2UgPSAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMuX29uSWNlQ29ubmVjdGlvblN0YXRlQ2hhbmdlLmFwcGx5KHRoaXMsIFtldmVudF0pO1xuICAgIH07XG4gICAgLypcbiAgICB0aGlzLl9wYy5vbmljZUNoYW5uZWxTdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICBfb25JY2VDaGFubmVsU3RhdGVDaGFuZ2UocGVlciwgZXZlbnQpO1xuICAgIH07XG4gICAgID0gZnVuY3Rpb24oKSB7XG4gICAgICBvbk5lZ290aWF0aW9ubmVlZGVkKHBlZXJzW3BlZXIuaWRdKTtcbiAgICB9O1xuXG4gICAgLy9EYXRhQ2hhbm5lbFxuICAgIHRoaXMuX3BjLm9uZGF0YWNoYW5uZWwgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgTG9nZ2VyLmRlYnVnKG15SWQgKyAnOiBPbiBkYXRhIGNoYW5uZWwnKTtcbiAgICAgIC8vIFNhdmUgcmVtb3RlIGNyZWF0ZWQgZGF0YSBjaGFubmVsLlxuICAgICAgaWYgKCFwZWVyLmRhdGFDaGFubmVsc1tldmVudC5jaGFubmVsLmxhYmVsXSkge1xuICAgICAgICBwZWVyLmRhdGFDaGFubmVsc1tldmVudC5jaGFubmVsLmxhYmVsXSA9IGV2ZW50LmNoYW5uZWw7XG4gICAgICAgIExvZ2dlci5kZWJ1ZygnU2F2ZSByZW1vdGUgY3JlYXRlZCBkYXRhIGNoYW5uZWwuJyk7XG4gICAgICB9XG4gICAgICBiaW5kRXZlbnRzVG9EYXRhQ2hhbm5lbChldmVudC5jaGFubmVsLCBwZWVyKTtcbiAgICB9OyovXG4gIH1cblxuICBfZHJhaW5QZW5kaW5nU3RyZWFtcygpIHtcbiAgICBsZXQgbmVnb3RpYXRpb25OZWVkZWQgPSBmYWxzZTtcbiAgICBMb2dnZXIuZGVidWcoJ0RyYWluaW5nIHBlbmRpbmcgc3RyZWFtcy4nKTtcbiAgICBpZiAodGhpcy5fcGMgJiYgdGhpcy5fcGMuc2lnbmFsaW5nU3RhdGUgPT09ICdzdGFibGUnKSB7XG4gICAgICBMb2dnZXIuZGVidWcoJ1BlZXIgY29ubmVjdGlvbiBpcyByZWFkeSBmb3IgZHJhaW5pbmcgcGVuZGluZyBzdHJlYW1zLicpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLl9wZW5kaW5nU3RyZWFtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBzdHJlYW0gPSB0aGlzLl9wZW5kaW5nU3RyZWFtc1tpXTtcbiAgICAgICAgLy8gT25OZWdvdGlhdGlvbk5lZWRlZCBldmVudCB3aWxsIGJlIHRyaWdnZXJlZCBpbW1lZGlhdGVseSBhZnRlciBhZGRpbmcgc3RyZWFtIHRvIFBlZXJDb25uZWN0aW9uIGluIEZpcmVmb3guXG4gICAgICAgIC8vIEFuZCBPbk5lZ290aWF0aW9uTmVlZGVkIGhhbmRsZXIgd2lsbCBleGVjdXRlIGRyYWluUGVuZGluZ1N0cmVhbXMuIFRvIGF2b2lkIGFkZCB0aGUgc2FtZSBzdHJlYW0gbXVsdGlwbGUgdGltZXMsXG4gICAgICAgIC8vIHNoaWZ0IGl0IGZyb20gcGVuZGluZyBzdHJlYW0gbGlzdCBiZWZvcmUgYWRkaW5nIGl0IHRvIFBlZXJDb25uZWN0aW9uLlxuICAgICAgICB0aGlzLl9wZW5kaW5nU3RyZWFtcy5zaGlmdCgpO1xuICAgICAgICBpZiAoIXN0cmVhbS5tZWRpYVN0cmVhbSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgdHJhY2sgb2Ygc3RyZWFtLm1lZGlhU3RyZWFtLmdldFRyYWNrcygpKSB7XG4gICAgICAgICAgdGhpcy5fcGMuYWRkVHJhY2sodHJhY2ssIHN0cmVhbS5tZWRpYVN0cmVhbSk7XG4gICAgICAgICAgbmVnb3RpYXRpb25OZWVkZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIExvZ2dlci5kZWJ1ZygnQWRkZWQgc3RyZWFtIHRvIHBlZXIgY29ubmVjdGlvbi4nKTtcbiAgICAgICAgdGhpcy5fcHVibGlzaGluZ1N0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgfVxuICAgICAgdGhpcy5fcGVuZGluZ1N0cmVhbXMubGVuZ3RoID0gMDtcbiAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgdGhpcy5fcGVuZGluZ1VucHVibGlzaFN0cmVhbXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKCF0aGlzLl9wZW5kaW5nVW5wdWJsaXNoU3RyZWFtc1tqXS5tZWRpYVN0cmVhbSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICgncmVtb3ZlU3RyZWFtJyBpbiB0aGlzLl9wYykge1xuICAgICAgICAgIHRoaXMuX3BjLnJlbW92ZVN0cmVhbSh0aGlzLl9wZW5kaW5nVW5wdWJsaXNoU3RyZWFtc1tqXS5tZWRpYVN0cmVhbSk7XG4gICAgICAgIH1cbiAgICAgICAgbmVnb3RpYXRpb25OZWVkZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLl91bnB1Ymxpc2hQcm9taXNlcy5nZXQoXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nVW5wdWJsaXNoU3RyZWFtc1tqXS5tZWRpYVN0cmVhbS5pZCkucmVzb2x2ZSgpO1xuICAgICAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1zLmRlbGV0ZSh0aGlzLl9wZW5kaW5nVW5wdWJsaXNoU3RyZWFtc1tqXSk7XG4gICAgICAgIExvZ2dlci5kZWJ1ZygnUmVtb3ZlIHN0cmVhbS4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3BlbmRpbmdVbnB1Ymxpc2hTdHJlYW1zLmxlbmd0aCA9IDA7XG4gICAgfVxuICAgIGlmIChuZWdvdGlhdGlvbk5lZWRlZCkge1xuICAgICAgdGhpcy5fb25OZWdvdGlhdGlvbm5lZWRlZCgpO1xuICAgIH1cbiAgfVxuXG4gIF9kcmFpblBlbmRpbmdSZW1vdGVJY2VDYW5kaWRhdGVzKCkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5fcmVtb3RlSWNlQ2FuZGlkYXRlcy5sZW5ndGg7IGkrKykge1xuICAgICAgTG9nZ2VyLmRlYnVnKCdBZGQgY2FuZGlkYXRlJyk7XG4gICAgICB0aGlzLl9wYy5hZGRJY2VDYW5kaWRhdGUodGhpcy5fcmVtb3RlSWNlQ2FuZGlkYXRlc1tpXSkuY2F0Y2goKGVycm9yKT0+e1xuICAgICAgICBMb2dnZXIud2FybmluZygnRXJyb3IgcHJvY2Vzc2luZyBJQ0UgY2FuZGlkYXRlOiAnK2Vycm9yKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLl9yZW1vdGVJY2VDYW5kaWRhdGVzLmxlbmd0aCA9IDA7XG4gIH1cblxuICBfZHJhaW5QZW5kaW5nTWVzc2FnZXMoKSB7XG4gICAgTG9nZ2VyLmRlYnVnKCdEcmFpbmluZyBwZW5kaW5nIG1lc3NhZ2VzLicpO1xuICAgIGlmICh0aGlzLl9wZW5kaW5nTWVzc2FnZXMubGVuZ3RoID09IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGMgPSB0aGlzLl9kYXRhQ2hhbm5lbHMuZ2V0KERhdGFDaGFubmVsTGFiZWwuTUVTU0FHRSk7XG4gICAgaWYgKGRjICYmIGRjLnJlYWR5U3RhdGUgPT09ICdvcGVuJykge1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLl9wZW5kaW5nTWVzc2FnZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKCdTZW5kaW5nIG1lc3NhZ2UgdmlhIGRhdGEgY2hhbm5lbDogJyt0aGlzLl9wZW5kaW5nTWVzc2FnZXNbaV0pO1xuICAgICAgICBkYy5zZW5kKEpTT04uc3RyaW5naWZ5KHRoaXMuX3BlbmRpbmdNZXNzYWdlc1tpXSkpO1xuICAgICAgfVxuICAgICAgdGhpcy5fcGVuZGluZ01lc3NhZ2VzLmxlbmd0aCA9IDA7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9wYyAmJiAhZGMpIHtcbiAgICAgIHRoaXMuX2NyZWF0ZURhdGFDaGFubmVsKERhdGFDaGFubmVsTGFiZWwuTUVTU0FHRSk7XG4gICAgfVxuICB9XG5cbiAgX3NlbmRTdHJlYW1JbmZvKHN0cmVhbSkge1xuICAgIGlmICghc3RyZWFtIHx8ICFzdHJlYW0ubWVkaWFTdHJlYW0pIHtcbiAgICAgIHJldHVybiBuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9DTElFTlRfSUxMRUdBTF9BUkdVTUVOVCk7XG4gICAgfVxuICAgIGNvbnN0IGluZm8gPSBbXTtcbiAgICBzdHJlYW0ubWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkubWFwKCh0cmFjaykgPT4ge1xuICAgICAgaW5mby5wdXNoKHtcbiAgICAgICAgaWQ6IHRyYWNrLmlkLFxuICAgICAgICBzb3VyY2U6IHN0cmVhbS5zb3VyY2VbdHJhY2sua2luZF0sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoW3RoaXMuX3NlbmRTaWduYWxpbmdNZXNzYWdlKFNpZ25hbGluZ1R5cGUuVFJBQ0tfU09VUkNFUyxcbiAgICAgICAgaW5mbyksXG4gICAgdGhpcy5fc2VuZFNpZ25hbGluZ01lc3NhZ2UoU2lnbmFsaW5nVHlwZS5TVFJFQU1fSU5GTywge1xuICAgICAgaWQ6IHN0cmVhbS5tZWRpYVN0cmVhbS5pZCxcbiAgICAgIGF0dHJpYnV0ZXM6IHN0cmVhbS5hdHRyaWJ1dGVzLFxuICAgICAgLy8gVHJhY2sgSURzIG1heSBub3QgbWF0Y2ggYXQgc2VuZGVyIGFuZCByZWNlaXZlciBzaWRlcy5cbiAgICAgIHRyYWNrczogQXJyYXkuZnJvbShpbmZvLCAoaXRlbSkgPT4gaXRlbS5pZCksXG4gICAgICAvLyBUaGlzIGlzIGEgd29ya2Fyb3VuZCBmb3IgU2FmYXJpLiBQbGVhc2UgdXNlIHRyYWNrLXNvdXJjZXMgaWYgcG9zc2libGUuXG4gICAgICBzb3VyY2U6IHN0cmVhbS5zb3VyY2UsXG4gICAgfSksXG4gICAgXSk7XG4gIH1cblxuXG4gIF9zZW5kU3lzSW5mb0lmTmVjZXNzYXJ5KCkge1xuICAgIGlmICh0aGlzLl9pbmZvU2VudCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICB0aGlzLl9pbmZvU2VudCA9IHRydWU7XG4gICAgcmV0dXJuIHRoaXMuX3NlbmRTaWduYWxpbmdNZXNzYWdlKFNpZ25hbGluZ1R5cGUuVUEsIHN5c0luZm8pO1xuICB9XG5cbiAgX3NlbmRDbG9zZWRNc2dJZk5lY2Vzc2FyeSgpIHtcbiAgICBpZiAodGhpcy5fcGMucmVtb3RlRGVzY3JpcHRpb24gPT09IG51bGwgfHxcbiAgICAgICAgdGhpcy5fcGMucmVtb3RlRGVzY3JpcHRpb24uc2RwID09PSAnJykge1xuICAgICAgcmV0dXJuIHRoaXMuX3NlbmRTaWduYWxpbmdNZXNzYWdlKFNpZ25hbGluZ1R5cGUuQ0xPU0VEKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgX2hhbmRsZVJlbW90ZUNhcGFiaWxpdHkodWEpIHtcbiAgICBpZiAodWEuc2RrICYmIHVhLnNkayAmJiB1YS5zZGsudHlwZSA9PT0gJ0phdmFTY3JpcHQnICYmIHVhLnJ1bnRpbWUgJiZcbiAgICAgICAgdWEucnVudGltZS5uYW1lID09PSAnRmlyZWZveCcpIHtcbiAgICAgIHRoaXMuX3JlbW90ZVNpZGVTdXBwb3J0c1JlbW92ZVN0cmVhbSA9IGZhbHNlO1xuICAgICAgdGhpcy5fcmVtb3RlU2lkZVN1cHBvcnRzUGxhbkIgPSBmYWxzZTtcbiAgICAgIHRoaXMuX3JlbW90ZVNpZGVTdXBwb3J0c1VuaWZpZWRQbGFuID0gdHJ1ZTtcbiAgICB9IGVsc2UgeyAvLyBSZW1vdGUgc2lkZSBpcyBpT1MvQW5kcm9pZC9DKysgd2hpY2ggdXNlcyBHb29nbGUncyBXZWJSVEMgc3RhY2suXG4gICAgICB0aGlzLl9yZW1vdGVTaWRlU3VwcG9ydHNSZW1vdmVTdHJlYW0gPSB0cnVlO1xuICAgICAgdGhpcy5fcmVtb3RlU2lkZVN1cHBvcnRzUGxhbkIgPSB0cnVlO1xuICAgICAgdGhpcy5fcmVtb3RlU2lkZVN1cHBvcnRzVW5pZmllZFBsYW4gPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBfZG9OZWdvdGlhdGUoKSB7XG4gICAgdGhpcy5fY3JlYXRlQW5kU2VuZE9mZmVyKCk7XG4gIH1cblxuICBfc2V0Q29kZWNPcmRlcihzZHApIHtcbiAgICBpZiAodGhpcy5fY29uZmlnLmF1ZGlvRW5jb2RpbmdzKSB7XG4gICAgICBjb25zdCBhdWRpb0NvZGVjTmFtZXMgPSBBcnJheS5mcm9tKHRoaXMuX2NvbmZpZy5hdWRpb0VuY29kaW5ncyxcbiAgICAgICAgICAoZW5jb2RpbmdQYXJhbWV0ZXJzKSA9PiBlbmNvZGluZ1BhcmFtZXRlcnMuY29kZWMubmFtZSk7XG4gICAgICBzZHAgPSBTZHBVdGlscy5yZW9yZGVyQ29kZWNzKHNkcCwgJ2F1ZGlvJywgYXVkaW9Db2RlY05hbWVzKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuX2NvbmZpZy52aWRlb0VuY29kaW5ncykge1xuICAgICAgY29uc3QgdmlkZW9Db2RlY05hbWVzID0gQXJyYXkuZnJvbSh0aGlzLl9jb25maWcudmlkZW9FbmNvZGluZ3MsXG4gICAgICAgICAgKGVuY29kaW5nUGFyYW1ldGVycykgPT4gZW5jb2RpbmdQYXJhbWV0ZXJzLmNvZGVjLm5hbWUpO1xuICAgICAgc2RwID0gU2RwVXRpbHMucmVvcmRlckNvZGVjcyhzZHAsICd2aWRlbycsIHZpZGVvQ29kZWNOYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBzZHA7XG4gIH1cblxuICBfc2V0TWF4Qml0cmF0ZShzZHAsIG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIG9wdGlvbnMuYXVkaW9FbmNvZGluZ3MgPT09ICdvYmplY3QnKSB7XG4gICAgICBzZHAgPSBTZHBVdGlscy5zZXRNYXhCaXRyYXRlKHNkcCwgb3B0aW9ucy5hdWRpb0VuY29kaW5ncyk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygb3B0aW9ucy52aWRlb0VuY29kaW5ncyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHNkcCA9IFNkcFV0aWxzLnNldE1heEJpdHJhdGUoc2RwLCBvcHRpb25zLnZpZGVvRW5jb2RpbmdzKTtcbiAgICB9XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIF9zZXRSdHBTZW5kZXJPcHRpb25zKHNkcCwgb3B0aW9ucykge1xuICAgIHNkcCA9IHRoaXMuX3NldE1heEJpdHJhdGUoc2RwLCBvcHRpb25zKTtcbiAgICByZXR1cm4gc2RwO1xuICB9XG5cbiAgX3NldFJ0cFJlY2VpdmVyT3B0aW9ucyhzZHApIHtcbiAgICBzZHAgPSB0aGlzLl9zZXRDb2RlY09yZGVyKHNkcCk7XG4gICAgcmV0dXJuIHNkcDtcbiAgfVxuXG4gIF9jcmVhdGVBbmRTZW5kT2ZmZXIoKSB7XG4gICAgaWYgKCF0aGlzLl9wYykge1xuICAgICAgTG9nZ2VyLmVycm9yKCdQZWVyIGNvbm5lY3Rpb24gaGF2ZSBub3QgYmVlbiBjcmVhdGVkLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9pc05lZ290aWF0aW9uTmVlZGVkID0gZmFsc2U7XG4gICAgdGhpcy5faXNDYWxsZXIgPSB0cnVlO1xuICAgIGxldCBsb2NhbERlc2M7XG4gICAgdGhpcy5fcGMuY3JlYXRlT2ZmZXIoKS50aGVuKChkZXNjKSA9PiB7XG4gICAgICBkZXNjLnNkcCA9IHRoaXMuX3NldFJ0cFJlY2VpdmVyT3B0aW9ucyhkZXNjLnNkcCk7XG4gICAgICBsb2NhbERlc2MgPSBkZXNjO1xuICAgICAgaWYodGhpcy5fcGMuc2lnbmFsaW5nU3RhdGU9PT0nc3RhYmxlJyl7XG4gICAgICAgIHJldHVybiB0aGlzLl9wYy5zZXRMb2NhbERlc2NyaXB0aW9uKGRlc2MpLnRoZW4oKCk9PntcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2VuZFNkcChsb2NhbERlc2MpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KS5jYXRjaCgoZSkgPT4ge1xuICAgICAgTG9nZ2VyLmVycm9yKGUubWVzc2FnZSArICcgUGxlYXNlIGNoZWNrIHlvdXIgY29kZWMgc2V0dGluZ3MuJyk7XG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvck1vZHVsZS5QMlBFcnJvcihFcnJvck1vZHVsZS5lcnJvcnMuUDJQX1dFQlJUQ19TRFAsXG4gICAgICAgICAgZS5tZXNzYWdlKTtcbiAgICAgIHRoaXMuX3N0b3AoZXJyb3IsIHRydWUpO1xuICAgIH0pO1xuICB9XG5cbiAgX2NyZWF0ZUFuZFNlbmRBbnN3ZXIoKSB7XG4gICAgdGhpcy5fZHJhaW5QZW5kaW5nU3RyZWFtcygpO1xuICAgIHRoaXMuX2lzTmVnb3RpYXRpb25OZWVkZWQgPSBmYWxzZTtcbiAgICB0aGlzLl9pc0NhbGxlciA9IGZhbHNlO1xuICAgIGxldCBsb2NhbERlc2M7XG4gICAgdGhpcy5fcGMuY3JlYXRlQW5zd2VyKCkudGhlbigoZGVzYykgPT4ge1xuICAgICAgZGVzYy5zZHAgPSB0aGlzLl9zZXRSdHBSZWNlaXZlck9wdGlvbnMoZGVzYy5zZHApO1xuICAgICAgbG9jYWxEZXNjPWRlc2M7XG4gICAgICB0aGlzLl9sb2dDdXJyZW50QW5kUGVuZGluZ0xvY2FsRGVzY3JpcHRpb24oKTtcbiAgICAgIHJldHVybiB0aGlzLl9wYy5zZXRMb2NhbERlc2NyaXB0aW9uKGRlc2MpO1xuICAgIH0pLnRoZW4oKCk9PntcbiAgICAgIHJldHVybiB0aGlzLl9zZW5kU2RwKGxvY2FsRGVzYyk7XG4gICAgfSkuY2F0Y2goKGUpID0+IHtcbiAgICAgIExvZ2dlci5lcnJvcihlLm1lc3NhZ2UgKyAnIFBsZWFzZSBjaGVjayB5b3VyIGNvZGVjIHNldHRpbmdzLicpO1xuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3JNb2R1bGUuUDJQRXJyb3IoRXJyb3JNb2R1bGUuZXJyb3JzLlAyUF9XRUJSVENfU0RQLFxuICAgICAgICAgIGUubWVzc2FnZSk7XG4gICAgICB0aGlzLl9zdG9wKGVycm9yLCB0cnVlKTtcbiAgICB9KTtcbiAgfVxuXG4gIF9sb2dDdXJyZW50QW5kUGVuZGluZ0xvY2FsRGVzY3JpcHRpb24oKXtcbiAgICBMb2dnZXIuaW5mbygnQ3VycmVudCBkZXNjcmlwdGlvbjogJyt0aGlzLl9wYy5jdXJyZW50TG9jYWxEZXNjcmlwdGlvbik7XG4gICAgTG9nZ2VyLmluZm8oJ1BlbmRpbmcgZGVzY3JpcHRpb246ICcrdGhpcy5fcGMucGVuZGluZ0xvY2FsRGVzY3JpcHRpb24pO1xuICB9XG5cbiAgX2dldEFuZERlbGV0ZVRyYWNrU291cmNlSW5mbyh0cmFja3MpIHtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHRyYWNrSWQgPSB0cmFja3NbMF0uaWQ7XG4gICAgICBpZiAodGhpcy5fcmVtb3RlVHJhY2tTb3VyY2VJbmZvLmhhcyh0cmFja0lkKSkge1xuICAgICAgICBjb25zdCBzb3VyY2VJbmZvID0gdGhpcy5fcmVtb3RlVHJhY2tTb3VyY2VJbmZvLmdldCh0cmFja0lkKTtcbiAgICAgICAgdGhpcy5fcmVtb3RlVHJhY2tTb3VyY2VJbmZvLmRlbGV0ZSh0cmFja0lkKTtcbiAgICAgICAgcmV0dXJuIHNvdXJjZUluZm87XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBMb2dnZXIud2FybmluZygnQ2Fubm90IGZpbmQgc291cmNlIGluZm8gZm9yICcgKyB0cmFja0lkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBfdW5wdWJsaXNoKHN0cmVhbSkge1xuICAgIGlmIChuYXZpZ2F0b3IubW96R2V0VXNlck1lZGlhIHx8ICF0aGlzLl9yZW1vdGVTaWRlU3VwcG9ydHNSZW1vdmVTdHJlYW0pIHtcbiAgICAgIC8vIEFjdHVhbGx5IHVucHVibGlzaCBpcyBzdXBwb3J0ZWQuIEl0IGlzIGEgbGl0dGxlIGJpdCBjb21wbGV4IHNpbmNlIEZpcmVmb3ggaW1wbGVtZW50ZWQgV2ViUlRDIHNwZWMgd2hpbGUgQ2hyb21lIGltcGxlbWVudGVkIGFuIG9sZCBBUEkuXG4gICAgICBMb2dnZXIuZXJyb3IoXG4gICAgICAgICAgJ1N0b3BwaW5nIGEgcHVibGljYXRpb24gaXMgbm90IHN1cHBvcnRlZCBvbiBGaXJlZm94LiBQbGVhc2UgdXNlIFAyUENsaWVudC5zdG9wKCkgdG8gc3RvcCB0aGUgY29ubmVjdGlvbiB3aXRoIHJlbW90ZSBlbmRwb2ludC4nXG4gICAgICApO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBFcnJvck1vZHVsZS5QMlBFcnJvcihcbiAgICAgICAgICBFcnJvck1vZHVsZS5lcnJvcnMuUDJQX0NMSUVOVF9VTlNVUFBPUlRFRF9NRVRIT0QpKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLl9wdWJsaXNoZWRTdHJlYW1zLmhhcyhzdHJlYW0pKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IEVycm9yTW9kdWxlLlAyUEVycm9yKFxuICAgICAgICAgIEVycm9yTW9kdWxlLmVycm9ycy5QMlBfQ0xJRU5UX0lMTEVHQUxfQVJHVU1FTlQpKTtcbiAgICB9XG4gICAgdGhpcy5fcGVuZGluZ1VucHVibGlzaFN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl91bnB1Ymxpc2hQcm9taXNlcy5zZXQoc3RyZWFtLm1lZGlhU3RyZWFtLmlkLCB7XG4gICAgICAgIHJlc29sdmU6IHJlc29sdmUsXG4gICAgICAgIHJlamVjdDogcmVqZWN0LFxuICAgICAgfSk7XG4gICAgICB0aGlzLl9kcmFpblBlbmRpbmdTdHJlYW1zKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBNYWtlIHN1cmUgfF9wY3wgaXMgYXZhaWxhYmxlIGJlZm9yZSBjYWxsaW5nIHRoaXMgbWV0aG9kLlxuICBfY3JlYXRlRGF0YUNoYW5uZWwobGFiZWwpIHtcbiAgICBpZiAodGhpcy5fZGF0YUNoYW5uZWxzLmhhcyhsYWJlbCkpIHtcbiAgICAgIExvZ2dlci53YXJuaW5nKCdEYXRhIGNoYW5uZWwgbGFiZWxlZCAnKyBsYWJlbCsnIGFscmVhZHkgZXhpc3RzLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXRoaXMuX3BjKSB7XG4gICAgICBMb2dnZXIuZGVidWcoJ1BlZXJDb25uZWN0aW9uIGlzIG5vdCBhdmFpbGFibGUgYmVmb3JlIGNyZWF0aW5nIERhdGFDaGFubmVsLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBMb2dnZXIuZGVidWcoJ0NyZWF0ZSBkYXRhIGNoYW5uZWwuJyk7XG4gICAgY29uc3QgZGMgPSB0aGlzLl9wYy5jcmVhdGVEYXRhQ2hhbm5lbChsYWJlbCk7XG4gICAgdGhpcy5fYmluZEV2ZW50c1RvRGF0YUNoYW5uZWwoZGMpO1xuICAgIHRoaXMuX2RhdGFDaGFubmVscy5zZXQoRGF0YUNoYW5uZWxMYWJlbC5NRVNTQUdFLCBkYyk7XG4gICAgdGhpcy5fb25OZWdvdGlhdGlvbm5lZWRlZCgpO1xuICB9XG5cbiAgX2JpbmRFdmVudHNUb0RhdGFDaGFubmVsKGRjKSB7XG4gICAgZGMub25tZXNzYWdlID0gKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLl9vbkRhdGFDaGFubmVsTWVzc2FnZS5hcHBseSh0aGlzLCBbZXZlbnRdKTtcbiAgICB9O1xuICAgIGRjLm9ub3BlbiA9IChldmVudCkgPT4ge1xuICAgICAgdGhpcy5fb25EYXRhQ2hhbm5lbE9wZW4uYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgfTtcbiAgICBkYy5vbmNsb3NlID0gKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLl9vbkRhdGFDaGFubmVsQ2xvc2UuYXBwbHkodGhpcywgW2V2ZW50XSk7XG4gICAgfTtcbiAgICBkYy5vbmVycm9yID0gKGV2ZW50KSA9PiB7XG4gICAgICBMb2dnZXIuZGVidWcoJ0RhdGEgQ2hhbm5lbCBFcnJvcjonLCBlcnJvcik7XG4gICAgfTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYWxsIE1lZGlhU3RyZWFtcyBpdCBiZWxvbmdzIHRvLlxuICBfZ2V0U3RyZWFtQnlUcmFjayhtZWRpYVN0cmVhbVRyYWNrKSB7XG4gICAgY29uc3Qgc3RyZWFtcyA9IFtdO1xuICAgIGZvciAoY29uc3QgW2lkLCBpbmZvXSBvZiB0aGlzLl9yZW1vdGVTdHJlYW1JbmZvKSB7XG4gICAgICBpZiAoIWluZm8uc3RyZWFtIHx8ICFpbmZvLnN0cmVhbS5tZWRpYVN0cmVhbSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgdHJhY2sgb2YgaW5mby5zdHJlYW0ubWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkpIHtcbiAgICAgICAgaWYgKG1lZGlhU3RyZWFtVHJhY2sgPT09IHRyYWNrKSB7XG4gICAgICAgICAgc3RyZWFtcy5wdXNoKGluZm8uc3RyZWFtLm1lZGlhU3RyZWFtKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3RyZWFtcztcbiAgfVxuXG4gIF9hcmVBbGxUcmFja3NFbmRlZChtZWRpYVN0cmVhbSkge1xuICAgIGZvciAoY29uc3QgdHJhY2sgb2YgbWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkpIHtcbiAgICAgIGlmICh0cmFjay5yZWFkeVN0YXRlID09PSAnbGl2ZScpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIF9zdG9wKGVycm9yLCBub3RpZnlSZW1vdGUpIHtcbiAgICBsZXQgcHJvbWlzZUVycm9yID0gZXJyb3I7XG4gICAgaWYgKCFwcm9taXNlRXJyb3IpIHtcbiAgICAgIHByb21pc2VFcnJvciA9IG5ldyBFcnJvck1vZHVsZS5QMlBFcnJvcihcbiAgICAgICAgICBFcnJvck1vZHVsZS5lcnJvcnMuUDJQX0NMSUVOVF9VTktOT1dOKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBbbGFiZWwsIGRjXSBvZiB0aGlzLl9kYXRhQ2hhbm5lbHMpIHtcbiAgICAgIGRjLmNsb3NlKCk7XG4gICAgfVxuICAgIHRoaXMuX2RhdGFDaGFubmVscy5jbGVhcigpO1xuICAgIGlmICh0aGlzLl9wYyAmJiB0aGlzLl9wYy5pY2VDb25uZWN0aW9uU3RhdGUgIT09ICdjbG9zZWQnKSB7XG4gICAgICB0aGlzLl9wYy5jbG9zZSgpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFtpZCwgcHJvbWlzZV0gb2YgdGhpcy5fcHVibGlzaFByb21pc2VzKSB7XG4gICAgICBwcm9taXNlLnJlamVjdChwcm9taXNlRXJyb3IpO1xuICAgIH1cbiAgICB0aGlzLl9wdWJsaXNoUHJvbWlzZXMuY2xlYXIoKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgcHJvbWlzZV0gb2YgdGhpcy5fdW5wdWJsaXNoUHJvbWlzZXMpIHtcbiAgICAgIHByb21pc2UucmVqZWN0KHByb21pc2VFcnJvcik7XG4gICAgfVxuICAgIHRoaXMuX3VucHVibGlzaFByb21pc2VzLmNsZWFyKCk7XG4gICAgZm9yIChjb25zdCBbaWQsIHByb21pc2VdIG9mIHRoaXMuX3NlbmREYXRhUHJvbWlzZXMpIHtcbiAgICAgIHByb21pc2UucmVqZWN0KHByb21pc2VFcnJvcik7XG4gICAgfVxuICAgIHRoaXMuX3NlbmREYXRhUHJvbWlzZXMuY2xlYXIoKTtcbiAgICAvLyBGaXJlIGVuZGVkIGV2ZW50IGlmIHB1YmxpY2F0aW9uIG9yIHJlbW90ZSBzdHJlYW0gZXhpc3RzLlxuICAgIHRoaXMuX3B1Ymxpc2hlZFN0cmVhbXMuZm9yRWFjaCgocHVibGljYXRpb24pID0+IHtcbiAgICAgIHB1YmxpY2F0aW9uLmRpc3BhdGNoRXZlbnQobmV3IE93dEV2ZW50KCdlbmRlZCcpKTtcbiAgICB9KTtcbiAgICB0aGlzLl9wdWJsaXNoZWRTdHJlYW1zLmNsZWFyKCk7XG4gICAgdGhpcy5fcmVtb3RlU3RyZWFtcy5mb3JFYWNoKChzdHJlYW0pID0+IHtcbiAgICAgIHN0cmVhbS5kaXNwYXRjaEV2ZW50KG5ldyBPd3RFdmVudCgnZW5kZWQnKSk7XG4gICAgfSk7XG4gICAgdGhpcy5fcmVtb3RlU3RyZWFtcyA9IFtdO1xuICAgIGlmICghdGhpcy5fZGlzcG9zZWQpIHtcbiAgICAgIGlmIChub3RpZnlSZW1vdGUpIHtcbiAgICAgICAgbGV0IHNlbmRFcnJvcjtcbiAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgc2VuZEVycm9yID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShlcnJvcikpO1xuICAgICAgICAgIC8vIEF2b2lkIHRvIGxlYWsgZGV0YWlsZWQgZXJyb3IgdG8gcmVtb3RlIHNpZGUuXG4gICAgICAgICAgc2VuZEVycm9yLm1lc3NhZ2UgPSAnRXJyb3IgaGFwcGVuZWQgYXQgcmVtb3RlIHNpZGUuJztcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9zZW5kU2lnbmFsaW5nTWVzc2FnZShTaWduYWxpbmdUeXBlLkNMT1NFRCwgc2VuZEVycm9yKS5jYXRjaChcbiAgICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKCdGYWlsZWQgdG8gc2VuZCBjbG9zZS4nICsgZXJyLm1lc3NhZ2UpO1xuICAgICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICB0aGlzLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdlbmRlZCcpKTtcbiAgICB9XG4gIH1cblxuICBfc2V0U3RyZWFtVG9SZW1vdGVTdHJlYW1JbmZvKG1lZGlhU3RyZWFtKSB7XG4gICAgY29uc3QgaW5mbyA9IHRoaXMuX3JlbW90ZVN0cmVhbUluZm8uZ2V0KG1lZGlhU3RyZWFtLmlkKTtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gaW5mby5hdHRyaWJ1dGVzO1xuICAgIGNvbnN0IHNvdXJjZUluZm8gPSBuZXcgU3RyZWFtTW9kdWxlLlN0cmVhbVNvdXJjZUluZm8odGhpcy5fcmVtb3RlU3RyZWFtSW5mb1xuICAgICAgICAuZ2V0KG1lZGlhU3RyZWFtLmlkKS5zb3VyY2UuYXVkaW8sIHRoaXMuX3JlbW90ZVN0cmVhbUluZm8uZ2V0KFxuICAgICAgICBtZWRpYVN0cmVhbS5pZClcbiAgICAgICAgLnNvdXJjZS52aWRlbyk7XG4gICAgaW5mby5zdHJlYW0gPSBuZXcgU3RyZWFtTW9kdWxlLlJlbW90ZVN0cmVhbShcbiAgICAgICAgdW5kZWZpbmVkLCB0aGlzLl9yZW1vdGVJZCwgbWVkaWFTdHJlYW0sXG4gICAgICAgIHNvdXJjZUluZm8sIGF0dHJpYnV0ZXMpO1xuICAgIGluZm8ubWVkaWFTdHJlYW0gPSBtZWRpYVN0cmVhbTtcbiAgICBjb25zdCBzdHJlYW0gPSBpbmZvLnN0cmVhbTtcbiAgICBpZiAoc3RyZWFtKSB7XG4gICAgICB0aGlzLl9yZW1vdGVTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2VyLndhcm5pbmcoJ0ZhaWxlZCB0byBjcmVhdGUgUmVtb3RlU3RyZWFtLicpO1xuICAgIH1cbiAgfVxuXG4gIF9jaGVja0ljZUNvbm5lY3Rpb25TdGF0ZUFuZEZpcmVFdmVudCgpIHtcbiAgICBjb25zb2xlLmxvZyhcIl9jaGVja0ljZUNvbm5lY3Rpb25TdGF0ZUFuZEZpcmVFdmVudC0tLS0tLS0tLS0tLS0+XCIpXG4gICAgaWYgKHRoaXMuX3BjLmljZUNvbm5lY3Rpb25TdGF0ZSA9PT0gJ2Nvbm5lY3RlZCcgfHxcbiAgICAgICAgdGhpcy5fcGMuaWNlQ29ubmVjdGlvblN0YXRlID09PSAnY29tcGxldGVkJykge1xuICAgICAgZm9yIChjb25zdCBbaWQsIGluZm9dIG9mIHRoaXMuX3JlbW90ZVN0cmVhbUluZm8pIHtcbiAgICAgICAgaWYgKGluZm8ubWVkaWFTdHJlYW0pIHtcbiAgICAgICAgICBjb25zdCBzdHJlYW1FdmVudCA9IG5ldyBTdHJlYW1Nb2R1bGUuU3RyZWFtRXZlbnQoJ3N0cmVhbWFkZGVkJywge1xuICAgICAgICAgICAgc3RyZWFtOiBpbmZvLnN0cmVhbSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAodGhpcy5faXNVbmlmaWVkUGxhbigpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHRyYWNrIG9mIGluZm8ubWVkaWFTdHJlYW0uZ2V0VHJhY2tzKCkpIHtcbiAgICAgICAgICAgICAgdHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5kZWQnLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZWRpYVN0cmVhbXMgPSB0aGlzLl9nZXRTdHJlYW1CeVRyYWNrKGV2ZW50LnRhcmdldCk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBtZWRpYVN0cmVhbSBvZiBtZWRpYVN0cmVhbXMpIHtcbiAgICAgICAgICAgICAgICAgIGlmICh0aGlzLl9hcmVBbGxUcmFja3NFbmRlZChtZWRpYVN0cmVhbSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fb25SZW1vdGVTdHJlYW1SZW1vdmVkKG1lZGlhU3RyZWFtKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9zZW5kU2lnbmFsaW5nTWVzc2FnZShTaWduYWxpbmdUeXBlLlRSQUNLU19BRERFRCwgaW5mby50cmFja0lkcyk7XG4gICAgICAgICAgdGhpcy5fcmVtb3RlU3RyZWFtSW5mby5nZXQoaW5mby5tZWRpYVN0cmVhbS5pZCkubWVkaWFTdHJlYW0gPSBudWxsO1xuICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChzdHJlYW1FdmVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUDJQUGVlckNvbm5lY3Rpb25DaGFubmVsO1xuIl19
