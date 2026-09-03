import {AlertCircle,Inbox} from 'lucide-react';
export function LoadingState({label='正在載入…'}:{label?:string}){return <div className="state-card" role="status"><span className="loader" aria-hidden="true"/>{label}</div>}
export function EmptyState({title,description}:{title:string;description?:string}){return <div className="state-card"><Inbox aria-hidden="true"/><strong>{title}</strong>{description&&<p>{description}</p>}</div>}
export function ErrorState({message}:{message:string}){return <div className="state-card error" role="alert"><AlertCircle aria-hidden="true"/><strong>目前無法顯示</strong><p>{message}</p></div>}
