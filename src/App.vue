<template>
  <div id="app">
    <div class="logo red">n</div>
    <div class="logo">crypt</div>

    <div id="subtitle">encrypt / decrypt text</div>

    <label for="message" class="label">message</label>
    <div id="clear" class="label btn" @click="clear()">clear</div>
    <textarea id="message" v-model="sot.message" @input="encrypt()" v-on:keyup="encrypt()" @change="encrypt()"></textarea>

    <label for="key" class="label">secret key (required)</label>
    <input type="text" id="key" v-model="sot.key" @input="ncrypt()" v-on:keyup="ncrypt()" @change="ncrypt()">

    <label for="cipher" class="label">cipher</label>
    <div id="copy" class="label btn" @click="copy()"> {{ copytext }} </div>
    <textarea v-model.trim="sot.cipher" @input="decrypt()" v-on:keyup="decrypt()" @change="decrypt()" id="cipher" ref="cipher"></textarea>

    <about id="about"/>

    <div id="footer">
      ncrypt &copy; {{ new Date().getFullYear() }}<br>
      <a class="link" href="https://github.com/routman/ncrypt.org" target="_blank" rel="noopener">source</a>
      <a class="link" href="https://cryptoji.com" target="_blank" rel="noopener">cryptoji</a>
      <a class="link" href="https://brainwallet.io" target="_blank" rel="noopener">brainwallet</a>
      <a class="link" href="https://publicnote.com" target="_blank" rel="noopener">publicnote</a>
      
    </div>

  </div>
</template>

<script>
import about from './components/about.vue'

export default {
  name: 'App',
  components: {
    about
  },
  data: function() {
    return {
      sot: this.$root.$data,
      copytext: 'copy'
    }
  },
  methods: {
    encrypt: function() {
      this.sot.encrypt();
    },
    decrypt: function() {
      this.sot.decrypt();
    },
    ncrypt: function() {
      this.sot.ncrypt();
    },
    clear: function() {
      this.sot.message = '';
      this.sot.key = '';
      this.sot.cipher = '';
    },
    copy: function() {
      this.$refs.cipher.select();
      document.execCommand('copy');
      this.copytext = 'copied!';
      setTimeout(function(){
        this.copytext = 'copy';
        window.getSelection().removeAllRanges()
      }.bind(this), 1200);
    }
  }
}
</script>

<style lang="scss">
@import "assets/settings.scss";

body {
  margin: 20px;
}

#app {
  font-family: 'Open Sans', sans-serif;
  font-weight: 300;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 20px;
}

.logo {
  display: inline-block;
  font-size: 28px;
  letter-spacing: 16px;
  user-select: none;
}

.red {
  color: $color-primary;
}

#subtitle {
  margin-top: 8px;
}

#about {
  margin-top: 40px;
}

.label {
  margin: 30px 0 6px 0;
  line-height: 30px;
  display: inline-block;
}

.btn {
  cursor: pointer;
  user-select: none;
}
.btn:hover {
  color: $color-accent !important;
}

.active {
  color: $color-primary;
  text-decoration: underline;
}

input:focus, textarea:focus {
  outline: none;
  border: 2px solid $color-black;
  border-image: linear-gradient(to right, $color-accent 0%, $color-primary 100%);
  border-image-slice: 1;
  box-shadow: 2px 2px 0px 0px #c884ff;
  padding: 9px;
}

textarea, input {
  box-shadow: none;
  -webkit-appearance: none;
  border: 1px solid $color-black;
  font-family: 'Open Sans', sans-serif;
  font-weight: 300;
  caret-color: $color-primary;
  font-size: 20px;
  border-radius: 0;
  box-sizing: border-box;
  box-shadow: 1px 1px 0px 0px #e69ec0;
  padding: 10px;
}

textarea {
  min-width: 100%;
  max-width: 100%;
  min-height: 220px;
}

input {
  width: 100%;
  height: 56px;
}

.link {
  text-decoration: underline;
  display: inline-block;
  cursor: pointer;
  color: $color-primary;
  margin: 20px 40px 0 0;
}

#copy {
  float: right;
}

#clear {
  float: right;
}

#footer {
  margin-bottom: 40px;
}

@media screen and (max-width: 824px) {
  .outer {
    width: 100%;
  }
}

</style>
