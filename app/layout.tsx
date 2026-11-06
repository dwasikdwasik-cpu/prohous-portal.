import './style.css';
import InstallApp from './InstallApp';
export const metadata={title:'Prohouse Sp. z o.o. — Portal klienta',description:'Zdjęcia inwestycji, faktury zakupowe i rozliczenia Prohouse Sp. z o.o.',applicationName:'Prohouse Sp. z o.o.',appleWebApp:{capable:true,title:'Prohouse Sp. z o.o.',statusBarStyle:'default'},icons:{apple:'/icons/prohous-180.png'}};
export const viewport={width:'device-width',initialScale:1,themeColor:'#cce7ff'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pl"><body>{children}<InstallApp/></body></html>}
