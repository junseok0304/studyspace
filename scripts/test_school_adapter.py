"""Read-only school flow regression tests; no real accounts or network requests."""
import io
import json
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote
import requests
import school_adapter as school

def response(url, text='', payload=None):
    result=Mock(url=url,text=text,status_code=200)
    result.json.return_value=payload
    return result

class SchoolAdapterTests(unittest.TestCase):
    def test_stops_at_lms_destination_instead_of_following_navigation_scripts(self):
        session=Mock()
        page=response(school.LMS_MAIN,"function logout(){location.href='/ilos/lo/logout.acl';}")
        self.assertIs(school.chase(session,page),page)
        session.get.assert_not_called()

    def test_redirect_chain_preserves_referer_and_decodes_entities(self):
        session=Mock()
        start=response('https://sso.skhu.ac.kr/bridge','<script>location.href="https://lms.skhu.ac.kr/ilos/sso/sso.jsp?a=1&amp;b=2";</script>')
        finish=response(school.LMS_MAIN)
        session.get.return_value=finish
        self.assertIs(school.chase(session,start),finish)
        session.get.assert_called_once_with('https://lms.skhu.ac.kr/ilos/sso/sso.jsp?a=1&b=2',headers={'Referer':start.url})

    def test_auto_submitted_sso_form_uses_origin_referer(self):
        session=Mock();start=response('https://sso.skhu.ac.kr/bridge','<form action="/ticket"><input name="ticket" value="test&amp;value"></form><script>document.forms[0].submit();</script>')
        finish=response(school.LMS_MAIN);session.post.return_value=finish
        self.assertIs(school.chase(session,start),finish)
        session.post.assert_called_once_with('https://sso.skhu.ac.kr/ticket',data={'ticket':'test&value'},headers={'Referer':start.url})

    def test_wrong_password_and_session_conflict_are_distinct(self):
        for message,code in [('비밀번호가 일치하지 않습니다','invalid_credentials'),('사용자 정보가 일치하지 않습니다','session_conflict'),('점검 중입니다','login_rejected')]:
            with self.subTest(code=code), self.assertRaises(school.SchoolError) as caught:
                school.check_login_error(response('https://portal.skhu.ac.kr/comm/redirectmessage.html?errorMsg='+quote(message)))
            self.assertEqual(caught.exception.code,code)

    def test_lms_verification_does_not_require_any_enrolled_course(self):
        school.verify_lms_page(response(school.LMS_COURSES,"YearInfo [ 0 ] = '2026^2'; /* no courses */"))
        for text,code in [('접속이 종료되었습니다','session_expired'),('<html>학교 점검</html>','lms_response_changed')]:
            with self.assertRaises(school.SchoolError) as caught:
                school.verify_lms_page(response(school.LMS_COURSES,text))
            self.assertEqual(caught.exception.code,code)

    def test_verify_matches_reference_headers_and_uses_one_portal_login(self):
        portal,enroll=Mock(),Mock()
        portal.__enter__=Mock(return_value=portal);portal.__exit__=Mock(return_value=False)
        enroll.__enter__=Mock(return_value=enroll);enroll.__exit__=Mock(return_value=False)
        portal.get.side_effect=[response('https://portal.skhu.ac.kr/publickeys',payload={'modulus':'test','publicExponent':'test'}),
                                response(school.LMS_COURSES,'YearInfo[0]="2026^2";')]
        portal.post.return_value=response(school.LMS_MAIN,"function menu(){location.href='/wrong';}")
        with patch.object(school,'SchoolSession',side_effect=[portal,enroll]),patch.object(school,'encrypt',return_value='test-cipher'):
            result=school.fetch({'mode':'verify','year':2026,'semester':'2','credentials':{'username':'test','password':'test'}})
        self.assertTrue(result['authenticated']);self.assertEqual(portal.post.call_count,1)
        self.assertEqual(portal.get.call_args.kwargs['headers']['Referer'],school.LMS_MAIN)

    def test_enrollment_request_uses_reference_parameters_and_read_only_paths(self):
        session=Mock()
        session.post.side_effect=[response('loginPage'),response('loginChk',payload={'code':200}),response('sugangList',payload={'rows':[]})]
        self.assertEqual(school.fetch_enrolled(session,{'username':'test','password':'test'}),[])
        calls=session.post.call_args_list
        self.assertIn('/loginChk?fake=',calls[1].args[0]);self.assertIn('/sugang/d/sugangList?fake=',calls[2].args[0])
        self.assertEqual(calls[1].kwargs['headers']['Content-Type'],'application/x-www-form-urlencoded; charset=UTF-8')
        self.assertEqual(calls[0].kwargs['data']['appInfo'],'0')

    def test_nexacro_reads_only_course_dataset_and_handles_empty_cells(self):
        xml='<Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters><Parameter id="ErrorCode">0</Parameter></Parameters><Dataset id="output1"><Rows><Row><Col id="COURSE_CD">A</Col><Col id="CLAS">1</Col><Col id="TITA"><![CDATA[월요일 / 10:00~11:00 / 101]]></Col><Col id="EMPTY"/></Row></Rows></Dataset></Root>'
        rows=school.parse_open_courses(xml)
        self.assertEqual(rows[0]['COURSE_CD'],'A');self.assertEqual(rows[0]['EMPTY'],'')
        self.assertEqual(rows[0]['TITA'],'월요일 / 10:00~11:00 / 101')
        with self.assertRaises(school.SchoolError): school.parse_open_courses('<Root><Parameters><Parameter id="ErrorCode">-1</Parameter></Parameters></Root>')
        with self.assertRaises(school.SchoolError): school.parse_open_courses('<!DOCTYPE Root><Root/>')

    def test_historical_lms_fragment_uses_reference_key_title_order(self):
        fragment='''<div><a onclick="eclassRoom('A20261KEY1')">열기</a><span>자료구조(CS101-01)</span></div>
                    <div><a onclick="eclassRoom('A20261KEY2')">열기</a><span>운영체제(CS202-02)</span></div>'''
        courses=school.parse_lms_course_fragment(fragment)
        self.assertEqual([course['name'] for course in courses],['자료구조','운영체제'])
        self.assertEqual(courses[1]['section'],'02')
        self.assertEqual(courses[0]['schedule'],'시간 미확인')

    def test_current_historical_lms_cards_use_title_and_schedule(self):
        fragment='''<div class="content-container"><p class="content-title">과정지도(IS00021-01)</p>
                    <ul class="content-author"><li><span>이승진</span></li><li><span>월요일/18:25~19:15/6202&nbsp;</span></li></ul></div>
                    <div class="content-container"><p class="content-title">리눅스시스템(IS00024-01)</p>
                    <ul class="content-author"><li><span>박정식</span></li><li><span>화요일/09:00~11:50/6406&nbsp;</span></li></ul></div>'''
        courses=school.parse_lms_course_fragment(fragment)
        self.assertEqual([course['name'] for course in courses],['과정지도','리눅스시스템'])
        self.assertEqual(courses[0]['code'],'LMS:IS00021')
        self.assertEqual(courses[0]['section'],'01')
        self.assertEqual(courses[1]['schedule'],'화요일/09:00~11:50/6406')

    def test_timeout_output_contains_only_reason_code(self):
        output=io.StringIO()
        with patch.object(school,'fetch',side_effect=requests.Timeout('sensitive value')),patch('sys.stdin',io.StringIO('{}')),patch('sys.stdout',output): school.main()
        self.assertEqual(json.loads(output.getvalue()),{'error':'network_timeout'})

    def test_unapproved_school_destination_is_rejected_before_sending(self):
        with school.SchoolSession() as session, self.assertRaises(school.SchoolError):
            session.send(requests.Request('GET','https://not-school.example/').prepare())

if __name__=='__main__': unittest.main()
