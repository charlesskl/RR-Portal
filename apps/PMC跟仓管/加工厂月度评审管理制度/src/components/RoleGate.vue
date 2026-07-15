<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import type { Role } from '../constants/roles'

const props = defineProps<{ allow: Role[] }>()
const auth = useAuthStore()
const ok = computed(() => !!auth.role && props.allow.includes(auth.role))
</script>
<template>
  <slot v-if="ok" />
</template>
