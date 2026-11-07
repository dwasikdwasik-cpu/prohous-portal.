export const isEmployeeLogin=value=>typeof value==='string'&&value.trim().toLowerCase()==='pracownik';
export async function signInEmployee(db,password){
 const {data,error}=await db.functions.invoke('project-employee-login',{body:{login:'pracownik',password}});
 if(error){let message='Nie udało się zalogować pracownika.';try{const response=await error.context?.json();if(typeof response?.error==='string')message=response.error}catch{}throw Error(message)}
 if(typeof data?.access_token!=='string'||typeof data?.refresh_token!=='string')throw Error('Nie udało się zalogować pracownika.');
 const result=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
 if(result.error)throw result.error;
 return result;
}
