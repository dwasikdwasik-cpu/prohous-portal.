import './style.css';
import InstallApp from './InstallApp';
export const metadata={title:'PROHOUS — Portal klienta',description:'Zdjęcia inwestycji, faktury zakupowe i rozliczenia PROHOUS.',applicationName:'PROHOUS',appleWebApp:{capable:true,title:'PROHOUS',statusBarStyle:'default'},icons:{apple:'/icons/prohous-180.png'}};
export const viewport={width:'device-width',initialScale:1,themeColor:'#204e44'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pl"><body>{children}<InstallApp/></body></html>}
