import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse, requireRole } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export async function PUT(request:NextRequest,context:{params:Promise<{id:string}>}){const auth=await requireRole(request,["admin"]);if(auth.response)return auth.response;const {id}=await context.params;return proxyResponse(await backendFetch(request,`/api/product-infos/${id}`,{method:"PUT",headers:{"content-type":"application/json"},body:await request.text()}));}
export async function DELETE(request:NextRequest,context:{params:Promise<{id:string}>}){const auth=await requireRole(request,["admin"]);if(auth.response)return auth.response;const {id}=await context.params;return proxyResponse(await backendFetch(request,`/api/product-infos/${id}`,{method:"DELETE"}));}
