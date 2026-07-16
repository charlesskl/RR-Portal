<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const email = ref('')
const password = ref('')
const error = ref('')
const auth = useAuthStore()
const router = useRouter()

async function onSubmit() {
  error.value = ''
  try {
    await auth.login(email.value, password.value)
    router.push('/dashboard')
  } catch (e: any) {
    error.value = '登录失败：' + (e?.message ?? '账号或密码错误')
  }
}
</script>

<template>
  <div class="login-bg">
    <div class="login-card">
      <div class="brand">🏭</div>
      <h1>加工厂月度评审管理</h1>
      <p class="sub">外协加工厂月度评审管理系统</p>
      <form @submit.prevent="onSubmit">
        <input v-model="email" type="email" placeholder="邮箱" required />
        <input v-model="password" type="password" placeholder="密码" required />
        <button type="submit">登 录</button>
        <p v-if="error" class="err">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-bg {
  min-height: 100vh; display: grid; place-items: center;
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%);
}
.login-card {
  background: #fff; width: 340px; max-width: 90vw; padding: 2.25rem 2rem;
  border-radius: 18px; box-shadow: 0 20px 50px -15px rgba(0,0,0,.35); text-align: center;
}
.brand { font-size: 2.5rem; margin-bottom: .5rem; }
.login-card h1 { font-size: 1.25rem; margin: 0 0 .3rem; }
.sub { color: var(--text-soft); font-size: .85rem; margin-bottom: 1.5rem; }
.login-card form { display: flex; flex-direction: column; gap: 0.75rem; }
.login-card input { padding: 0.65rem; font-size: 1rem; }
.login-card button { padding: 0.7rem; font-size: 1rem; letter-spacing: 2px; margin-top: .25rem; }
.err { color: var(--grade-d); font-size: .85rem; margin: 0; }
</style>
