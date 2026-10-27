"""Pure comparison only: the three confirmed Docker empty-DNS representations."""
import copy,json
EMPTY_DNS_FIELDS=('Dns','DnsOptions','DnsSearch')

def same_host_config(expected,observed):
 if type(expected)is not dict or type(observed)is not dict:return False
 old=copy.deepcopy(expected);new=copy.deepcopy(observed)
 for key in EMPTY_DNS_FIELDS:
  if key in old and key in new and(old[key]is None or type(old[key])is list and len(old[key])==0)and(new[key]is None or type(new[key])is list and len(new[key])==0):old[key]=None;new[key]=None
 try:
  encode=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
  return encode(old)==encode(new)
 except(TypeError,ValueError):return False
