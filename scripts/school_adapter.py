"""SKHU read-only timetable adapter. Credentials are received on stdin only.

Based on the user's sugangauto_python3 portal/TIS and enrollment flow.
No course registration, cancellation, grade or attendance operations.
"""
import html
import json
import re
import secrets
import sys
import uuid
from urllib.parse import urljoin, urlparse
import requests

HOSTS = {'portal.skhu.ac.kr', 'tis.skhu.ac.kr', 'sso.skhu.ac.kr', 'sugang.skhu.ac.kr', 'lms.skhu.ac.kr'}

class SchoolSession(requests.Session):
    def send(self, request, **kwargs):
        url = urlparse(request.url)
        if url.scheme != 'https' or url.hostname not in HOSTS:
            raise ValueError('Unexpected school destination')
        kwargs['timeout'] = 12
        response = super().send(request, **kwargs)
        response.raise_for_status()
        return response

def encrypt(value, key):
    modulus = int(key['modulus'],16)
    size = (modulus.bit_length()+7)//8
    raw = value.encode('utf-8')
    if len(raw)>size-11:
        raise ValueError('Input too long')
    pad=bytes(secrets.randbelow(255)+1 for _ in range(size-len(raw)-3))
    return format(pow(int.from_bytes(b'\0\2'+pad+b'\0'+raw,'big'),int(key['publicExponent'],16),modulus),'x')

def chase(session, response):
    for _ in range(6):
        body=response.text
        target=re.search(r'location\.(?:href\s*=\s*[\"\x27]([^\"\x27]+)|replace\(\s*[\"\x27]([^\"\x27]+))',body,re.I)
        meta=re.search(r'<meta[^>]+content=[\"\x27]?\d+\s*;\s*url=([^\"\x27>\s]+)',body,re.I)
        if target or meta:
            found=target or meta
            response=session.get(urljoin(response.url,next(g for g in found.groups() if g)))
            continue
        form=re.search(r'<form[^>]+action=[\"\x27]([^\"\x27]+)',body,re.I)
        if form and re.search(r'\.submit\s*\(',body):
            fields={}
            for tag in re.findall(r'<input\b[^>]*>',body,re.I):
                name=re.search(r'name=[\"\x27]([^\"\x27]+)',tag,re.I)
                value=re.search(r'value=[\"\x27]([^\"\x27]*)',tag,re.I)
                if name: fields[name.group(1)]=html.unescape(value.group(1)) if value else ''
            response=session.post(urljoin(response.url,form.group(1)),data=fields)
            continue
        return response
    raise ValueError('Redirect limit')

def fetch(data):
    credentials=data['credentials']; year=str(data['year']); semester=data['semester']
    with SchoolSession() as portal, SchoolSession() as enroll:
        key=portal.get('https://portal.skhu.ac.kr/publickeys').json()
        target='https://lms.skhu.ac.kr/ilos/sso/sso.jsp' if data.get('mode')=='verify' else 'https://tis.skhu.ac.kr'
        login=portal.post('https://portal.skhu.ac.kr/sso/login',data={'uid':encrypt(credentials['username'],key),'upw':encrypt(credentials['password'],key),'returnUrl':target},headers={'Referer':'https://portal.skhu.ac.kr/html/main/sso.html'})
        final=chase(portal,login)
        if 'redirectmessage' in final.url: raise ValueError('Login failed')
        if data.get('mode')=='verify':
            page=portal.get('https://lms.skhu.ac.kr/ilos/mp/course_register_list_form.acl')
            if '접속이 종료' in page.text or '사용자 정보가 일치하지 않습니다' in page.text: raise ValueError('Login failed')
            if not re.search(r'YearInfo\[\d+\]',page.text): raise ValueError('LMS session not verified')
            return {'authenticated':True}
        if not any(c.name.startswith('TIS') for c in portal.cookies):
            portal.get('https://tis.skhu.ac.kr/')
        if not any(c.name.startswith('TIS') for c in portal.cookies): raise ValueError('No TIS session')
        base='https://sugang.skhu.ac.kr'
        enroll.get(base+'/')
        enroll.post(base+'/loginPage',data={'appInfo':'0','wName':str(uuid.uuid4())})
        result=enroll.post(base+'/loginChk',data={'txtUserID':credentials['username'],'txtPwd':credentials['password']},headers={'Referer':base+'/loginPage','X-Requested-With':'XMLHttpRequest'}).json()
        if str(result.get('code')) not in ('200','201'): raise ValueError('Login failed')
        enroll.get(base+'/core/home')
        rows=enroll.post(base+'/sugang/d/sugangList',data={},headers={'Referer':base+'/core/home','X-Requested-With':'XMLHttpRequest'}).json()['rows']
        trans=[{'id':'select','recvDataset':'ds_main','sqlId':'kr.co.codefarm.svcm.ul.ul03_0303004.select','parameters':{'YEAR':year,'SMST_GBCD':semester,'ESTB_ASGN_CD':'','PESN_NM':'','COURSE_CNM':''},'fileOptions':None}]
        xml='<Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters><Parameter id="TRANS_INFO">'+html.escape(json.dumps(trans))+'</Parameter><Parameter id="SYSTEM_MENU_CD">undefined</Parameter><Parameter id="SYSTEM_LOGGING">Y</Parameter><Parameter id="SYSTEM_CHECK_SCHE">N</Parameter></Parameters></Root>'
        response=portal.post('https://tis.skhu.ac.kr/ul/ul03_0303004',data=xml.encode(),headers={'Content-Type':'text/xml; charset=UTF-8','Referer':'https://tis.skhu.ac.kr/app-nexa/index.html'}).text
        # Parse only the course fields used for the selected semester; never persist raw responses.
        opened={}
        for raw in re.findall(r'<Row>(.*?)</Row>',response,re.S):
            row={k:html.unescape(v) for k,v in re.findall(r'<Col id="([^"]+)">([^<]*)</Col>',raw)}
            opened[(row.get('COURSE_CD'),row.get('CLAS'))]=row
        courses=[]
        for row in rows:
            # Fail closed if the enrolled semester cannot be established.
            row_year=str(row.get('year',''))
            row_semester=str(row.get('smst_gbcd',row.get('smst','')))
            if row_year != year or row_semester != semester: raise ValueError('Semester mismatch or unknown')
            code=str(row.get('course_cd','')); section=str(row.get('clas',''))
            name=str(row.get('course_nm',''))
            if not code or not section or not name: raise ValueError('Missing course identity')
            match=opened.get((code,section),{})
            courses.append({'code':code,'section':section,'name':name[:120],'schedule':match.get('TITA','시간 미확인')[:500]})
        return {'year':int(year),'semester':semester,'courses':courses}

if __name__ == '__main__':
    try:
        result=fetch(json.load(sys.stdin))
        output=json.dumps(result,ensure_ascii=False)
        if len(output.encode())>50000: raise ValueError('Response too large')
        print(output)
    except Exception:
        print('{"error":"school_import_failed"}')
