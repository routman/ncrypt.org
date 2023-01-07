import Vue from 'vue'
import App from './App.vue'
var CryptoJS = require("crypto-js");
require('typeface-open-sans')
Vue.config.productionTip = false

var ncrypt = {
  message: '',
  xmessage: '',
  key: '',
  xkey: '',
  cipher: '',
  xcipher: '',
  last: 'encrypt',
  encrypt: function() {
    if (ncrypt.message != ncrypt.xmessage || ncrypt.key != ncrypt.xkey) {
      ncrypt.last = 'encrypt';

      if (ncrypt.key != '') {
        ncrypt.xmessage = ncrypt.message;
        ncrypt.xkey = ncrypt.key;
        ncrypt.cipher = CryptoJS.AES.encrypt(ncrypt.message, ncrypt.key).toString();
      }
    }
  },
  decrypt: function() {
    if (ncrypt.cipher != ncrypt.xcipher || ncrypt.key != ncrypt.xkey ) {
      ncrypt.last = "decrypt";
      ncrypt.xcipher = ncrypt.cipher;
      ncrypt.xkey = ncrypt.key;
      try {
        var bytes  = CryptoJS.AES.decrypt(ncrypt.cipher, ncrypt.key);
        ncrypt.message = bytes.toString(CryptoJS.enc.Utf8);
      } catch (error) {
        ncrypt.message = '';
      }
    }
  },
  ncrypt: function() {
    if (ncrypt.last == 'encrypt') {
      ncrypt.encrypt();
    }
    else if (ncrypt.last == 'decrypt') {
      ncrypt.decrypt();
    }
  }
}

new Vue({
  render: function (h) { return h(App) },
  data: ncrypt
}).$mount('#app')
