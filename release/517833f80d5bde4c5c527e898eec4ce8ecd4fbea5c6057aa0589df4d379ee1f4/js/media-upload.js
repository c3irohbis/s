/* Shared authenticated upload transport. Public cloud name is not a credential. */
import { auth } from './app/a-init-config.js';
const ENDPOINT='https://bliss-gateway.cairohbis.workers.dev/v1/media/upload';
export async function uploadMedia(file,onProgress=()=>{},context='general') {
 if(!file||!file.size)throw Error('الملف فارغ');
 const video=/\.(mp4|mov|webm)$/i.test(file.name||'')||(file.type||'').startsWith('video/');
 const max=(video?100:10)*1000*1000;
 if(file.size>max)throw Error(video?'أقصى حجم للفيديو 100MB':'أقصى حجم للملف 10MB');
 const user=auth.currentUser;
 if(!user)throw Error('سجل الدخول قبل الرفع');
 const uid=user.uid,token=await user.getIdToken();
 if(auth.currentUser?.uid!==uid)throw Error('تغير الحساب أثناء الرفع');
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('POST',ENDPOINT);xhr.timeout=130000;
  xhr.setRequestHeader('Authorization','Bearer '+token);
  xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name||'upload.webm'));
  xhr.setRequestHeader('X-Upload-Context',context);
  xhr.upload.addEventListener('progress',e=>{if(e.lengthComputable)onProgress({loaded:e.loaded,total:e.total,pct:Math.round(e.loaded/e.total*100),phase:'uploading'});});
  xhr.addEventListener('load',()=>{try{
   if(auth.currentUser?.uid!==uid)throw Error('تغير الحساب أثناء الرفع');
   const data=JSON.parse(xhr.responseText);
   if(xhr.status<200||xhr.status>=300||!data.secure_url)throw Error('فشل الرفع: '+(data.error?.code||xhr.status));
   if(!data.secure_url.startsWith('https://res.cloudinary.com/h198yuha/'))throw Error('رابط رفع غير صالح');
   onProgress({pct:100,phase:'complete'});resolve(data);
  }catch(e){reject(e);}});
  xhr.addEventListener('error',()=>reject(Error('تعذر الاتصال بخادم الرفع')));
  xhr.addEventListener('timeout',()=>reject(Error('انتهت مهلة الرفع')));
  xhr.addEventListener('abort',()=>reject(Error('تم إلغاء الرفع')));
  xhr.send(file);
 });
}
window.BisMediaUpload={upload:uploadMedia};
