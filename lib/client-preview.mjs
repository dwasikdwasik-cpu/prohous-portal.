/** Mirrors client document visibility, including finance metadata on other categories. */
export function clientDocumentVisible(profile,investment,document){
 return profile?.role==='client'&&profile.status==='approved'&&investment?.client_id===profile.id&&!investment.deleted_at&&
  document?.investment_id===investment.id&&!document.deleted_at&&document.published===true&&
  (investment.client_invoices_visible===true||(['zdjecia','projekty','umowy','protokoly'].includes(document.category)&&document.invoice_number==null&&document.invoice_date==null&&document.gross_amount==null));
}
/** Uses the administrator's session; never creates a client session or writes data.
 * @param {any} db
 * @param {string} clientId
 * @param {string|null} [investmentId]
 */
export async function loadClientPreview(db,clientId,investmentId=null){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))throw Error('404');
 const target=await db.from('profiles').select('id,full_name,email,role,status').eq('id',clientId).eq('role','client').maybeSingle();
 if(target.error)throw target.error;if(!target.data)throw Error('404');
 const profile=target.data;
 const empty={profile,investments:[],selected:'',documents:[],entries:[],availableBalance:null,cameras:[]};
 if(profile.status!=='approved')return empty;
 const source=await db.from('investments').select('*').eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}).limit(1000);
 if(source.error)throw source.error;const investments=source.data||[];
 const selected=investmentId||investments[0]?.id||'',investment=investments.find(row=>row.id===selected);
 if(investmentId&&!investment)throw Error('404');if(!investment)return {...empty,investments};
 let documents=db.from('documents').select('*').eq('investment_id',selected).is('deleted_at',null).eq('published',true).order('created_at',{ascending:false}).limit(1000);
 if(investment.client_invoices_visible!==true)documents=documents.in('category',['zdjecia','projekty','umowy','protokoly']).is('invoice_number',null).is('invoice_date',null).is('gross_amount',null);
 const balanceVisible=investment.client_balance_visible===true;
 const results=await Promise.all([
  documents,
  balanceVisible?db.from('ledger_entries').select('*').eq('investment_id',selected).order('created_at',{ascending:false}).limit(1000):Promise.resolve({data:[],error:null}),
  balanceVisible?db.rpc('get_portal_balance',{p_investment_id:selected}):Promise.resolve({data:null,error:null}),
  db.from('investment_cameras').select('id,investment_id,name,playback_type,playback_url,client_visible').eq('investment_id',selected).eq('client_visible',true).order('created_at').limit(1000)
 ]);
 const failure=results.find(result=>result.error)?.error;if(failure)throw failure;
 return {profile,investments,selected,documents:results[0].data||[],entries:results[1].data||[],availableBalance:results[2].data,cameras:results[3].data||[]};
}
