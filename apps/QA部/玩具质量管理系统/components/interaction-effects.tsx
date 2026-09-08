"use client";
import { useEffect,useRef,useState } from "react";
import { usePathname } from "next/navigation";
import { CursorArrowRaysIcon } from "@heroicons/react/24/outline";

const storageKey="toyqms_presentation_cursor";

export function InteractionEffects(){
  const pathname=usePathname();const dashboard=pathname.replace(/\/$/,"")==="/dashboard";const ring=useRef<HTMLDivElement>(null);const frame=useRef<number|null>(null);const idle=useRef<number|null>(null);const latest=useRef({x:-100,y:-100});const [enabled,setEnabled]=useState(false);const [ready,setReady]=useState(false);
  useEffect(()=>{setEnabled(window.localStorage.getItem(storageKey)==="true");setReady(true)},[]);
  useEffect(()=>{if(!dashboard||!enabled)return;const precise=window.matchMedia("(pointer: fine)").matches;const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;if(!precise||reduced)return;
    const draw=()=>{frame.current=null;if(!ring.current)return;ring.current.style.transform=`translate3d(${latest.current.x-17}px,${latest.current.y-17}px,0)`;ring.current.style.opacity="1"};
    const move=(event:PointerEvent)=>{latest.current={x:event.clientX,y:event.clientY};if(!frame.current)frame.current=requestAnimationFrame(draw);if(ring.current){const target=event.target as HTMLElement;ring.current.dataset.quiet=String(Boolean(target.closest("input,textarea,[contenteditable='true'],[role='textbox']")))}if(idle.current)window.clearTimeout(idle.current);idle.current=window.setTimeout(()=>{if(ring.current)ring.current.style.opacity=".28"},1100)};
    document.addEventListener("pointermove",move,{passive:true});return()=>{document.removeEventListener("pointermove",move);if(frame.current)cancelAnimationFrame(frame.current);if(idle.current)window.clearTimeout(idle.current)}
  },[dashboard,enabled]);
  useEffect(()=>{if(!dashboard)return;const click=(event:PointerEvent)=>{if(event.button!==0)return;const target=event.target as HTMLElement;if(!target.closest("button,a,[data-clickable='true'],[role='option']")||target.closest("input,textarea,[contenteditable='true']"))return;const ripple=document.createElement("span");ripple.className=`toyqms-click-ripple${target.closest("[data-danger='true']")?" is-danger":""}`;ripple.style.left=`${event.clientX}px`;ripple.style.top=`${event.clientY}px`;document.body.appendChild(ripple);ripple.addEventListener("animationend",()=>ripple.remove(),{once:true})};document.addEventListener("pointerdown",click,{passive:true});return()=>document.removeEventListener("pointerdown",click)},[dashboard]);
  const toggle=()=>setEnabled(current=>{const next=!current;window.localStorage.setItem(storageKey,String(next));return next});
  if(!dashboard||!ready)return null;
  return <><button type="button" aria-pressed={enabled} onClick={toggle} className={`presentation-toggle glass-strong fixed bottom-5 right-5 z-[82] inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${enabled?"is-on text-orange-800":"text-neutral-600"}`}><CursorArrowRaysIcon className="h-4 w-4"/><span>演示鼠标</span><i className={`h-2 w-2 rounded-full ${enabled?"bg-accent":"bg-neutral-300"}`}/></button>{enabled&&<div ref={ring} aria-hidden="true" className="presentation-cursor-ring fixed left-0 top-0 z-[81] h-[34px] w-[34px] rounded-full opacity-0"/>}</>
}
