<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import DynamicAnalysisPanel from '../components/DynamicAnalysisPanel.vue'
const route = useRoute()
</script>
<template><AppLayout class="analysis-layout"><DynamicAnalysisPanel :factory-id="typeof route.query.factory === 'string' ? route.query.factory : undefined" /></AppLayout></template>

<style scoped>
@media (max-width: 700px) {
  .analysis-layout :deep(.body) { flex-direction: column; }
  .analysis-layout :deep(aside) { width: 100%; padding: 8px; border-right: 0; }
  .analysis-layout :deep(aside nav) { flex-direction: row; overflow-x: auto; position: static; }
  .analysis-layout :deep(aside nav a) { white-space: nowrap; }
  .analysis-layout :deep(main) { padding: 12px; }
}
</style>
