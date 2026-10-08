import { useEffect } from "react";
import { authApi } from "@/api/endpoints";
import { getToken } from "@/lib/auth";

// 在线心跳:登录状态下每 60s 打一次 POST /auth/heartbeat。
// 活动标记=最近 10 分钟内有鼠标/键盘操作;后端据此判定 在线(<=10min)/忙线(>10min)/离线(心跳断>3min)。
const ACTIVITY_EVENTS = ["mousedown", "keydown", "wheel", "touchstart"] as const;
const IDLE_MS = 10 * 60 * 1000;
const INTERVAL_MS = 60 * 1000;

export function useHeartbeat() {
  useEffect(() => {
    if (!getToken()) return;
    let lastActive = Date.now();
    const onActivity = () => {
      lastActive = Date.now();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
    const beat = () => {
      void authApi.heartbeat(Date.now() - lastActive < IDLE_MS).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, INTERVAL_MS);
    return () => {
      clearInterval(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
    };
  }, []);
}
