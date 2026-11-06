import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest {
 return {id:'/',name:'Prohouse Sp. z o.o. — Portal inwestycji',short_name:'Prohouse Sp. z o.o.',description:'Projekty, zdjęcia i rozliczenia Twoich inwestycji.',lang:'pl',start_url:'/',scope:'/',display:'standalone',background_color:'#eef7ff',theme_color:'#cce7ff',icons:[{src:'/icons/prohous-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/prohous-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icons/prohous-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]};
}
