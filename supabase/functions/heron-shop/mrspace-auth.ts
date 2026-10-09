// Public project URL / publishable key. No cross-project service key or password.
const MRSPACE='https://tizfdnsjhhepxnqqrzuk.supabase.co';
const PUBLISHABLE='sb_publishable_DcfxBTRo0n2m1go5_yYjkw_qNzD6ie6';
export async function mrspaceAdmin(req:Request,transport=fetch){
 const token=req.headers.get('x-mrspace-token')||'';
 if(token.length<40||token.length>6000)return false;
 try {
  const r=await transport(MRSPACE+'/rest/v1/rpc/ms_heron_admin_access',{method:'POST',
   headers:{apikey:PUBLISHABLE,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
  return r.ok&&(await r.json())===true;
 }catch{return false;}
}
