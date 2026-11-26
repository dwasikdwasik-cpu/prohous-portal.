async function PHAllLedgers(employees,month,dates,entries,shifts,absences,index) {
  if(!index || !dates.length || !employees.length)throw Error('Wybierz miesiąc i poczekaj na wczytanie ewidencji.');
  const pages=[];
  const byEmployee=new Map();
  const first=dates[0],last=dates[dates.length-1];
  for(const entry of entries) {
    if(entry.work_date<first || entry.work_date>last)continue;
    if(!byEmployee.has(entry.employee_id))byEmployee.set(entry.employee_id,new Map());
    byEmployee.get(entry.employee_id).set(entry.work_date,entry);
  }
  for(const employee of employees) {
    const raw=byEmployee.get(employee.id)||new Map();
    const manual=PHCapWorkdays(raw,employee.id,index);
    const recorded=Ue(shifts,employee.id);
    await PHLedgerPDF(employee,month,dates,raw,manual,recorded,absences,index,pages);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const blob=PHImagesPDF(pages,1240,1754);
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='ProHouse_Ewidencja_wszyscy_'+month+'.pdf';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
