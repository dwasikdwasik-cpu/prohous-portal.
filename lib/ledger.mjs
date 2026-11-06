export function ledgerTotals(entries){
 let deposits=0,expenses=0;
 for(const entry of entries){const cents=Math.round(Number(entry.amount)*100);
  if(entry.type==='deposit')deposits+=cents;
  if(entry.type==='expense')expenses+=cents;
  if(entry.type==='expense_reversal')expenses-=cents;
 }
 return {deposits:deposits/100,expenses:expenses/100,balance:(deposits-expenses)/100};
}
