/* Public-chat masking only. Static, synchronous, no network or persistence. */
(function () {
  'use strict';
  const BAD_WORDS = "حمار|غبي|حيوان|زباله|وسخ|واطي|قذر|خول|عرص|معرص|متناك|شرموطه|ابن الكلب|ابن الوسخه|ابن الحرام|يا كلب|7mar|ghaby|zebala|khawal|3ars|wes5|fuck|shit|bitch|*damn|*dyke|*fuck*|*rse|*rsehole|*shit*|0ral seks|0ral sex|0rg@sm|0rgasms|3jakulating|4r5e|4r5ed|4r5es|4skin|5h17|5h1t|5hit|5kank|@$|@55|@ss|@ssfcker|@ssfucker|@ssfvcker|@sshole|a**|a**hat|a**hole|a55|a_s_s|abeed|ahole|amcik|anal|anal hole|anal hore|anal pirate|analingus|analplug|analplugs|andskota|anilingus|animal fucker|anus|anus plug|ape shit|ape shite|apeshit|apeshite|ar5e|ar5ehole|arabianchicks|arabsex|arabxxx|arrse|arschloch|arse gobbler|arse hole|arse*|arse-bandit|arse-bandits|arse-fucker|arse-fuckers|arse-hole|arse-shagger|arseface|arsefuck|arsefucker|arsehead|arsehole|arseshit|arsewipe|ash0le|ash0les|ashole|asholes|ass|ass bandit|ass eating boiolas|ass eating nob jokeys|ass fecker|ass fuck|ass fucker|ass fucking boiolas|ass fucking nob jokeys|ass hole|ass kisser|ass licking|Ass Monkey|ass muncher|ass-bandit|ass-fucker|ass-fuckers|ass-hat|ass-hole|assbandit|assclown|asses|Assface|assfck|assfcker|assfk|assfkcer|assfker|assfkr|assfook|assfuccer|assfuck|assfuck3r|assfucker|assfuckers|assfuckerz|assfukah|assfukka|assfukker|assfukkerz|assfvck3r|assfvcker|assh0lez|asshat|asshol3|asshole fucker|assholz|asskisser|assmunch|assmuncher|assrammer|asswhole|asswipe|axe wound|ayir|azz|azzhole|b to the inch|b!+ch|b!tch|b*g|b*gger|b*llocking|b*llocks|b*lls|b*stard|b*tch|b*ttf*ck|b*tthead|b*ttlicker|b00b*|b00bs|b00bz|b0llock|b0llocks|b1+ch|b17ch|b1otch|b1otchs|b1tch|b1tch1ng|b1tch35|b1tch3s|b1tchees|b1tchez|b1tchin|b1tching|b1tchs|b1tchy|b@lls|b@stard|baby batter|ballbag|ballbuster|ballhead|balls|ballsack|bangbros|bassterds|bassturd|bastard|bastardish|bastards|bastardz|basterd|basterdz|bastid|bater|batshit|batshite|baztad|bean queen|beaner|beaners|beastial|beastiality|beat my meat|beat off|beat the meat|beat your meat|beeotch|bell end|bellend|bestial|bestiality|bewbs|beyoch|beyotch|bi + ch|bi+ch|bi7ch|Biatch|biches|biotch|biotches|biotchez|bish|bishes|bitch*|bitch3s|bitchass|bitchasses|bitched|bitcher|bitchers|bitches|bitchez|bitchfuck|bitchhole|bitchin|bitchin'|bitching|bitchlike|bitchness|bitchs|bitchslap|bitchtits|bitchy|bitchy ass|bizzach|BJ|bl**dy|blacky|bloody|blow a load|Blow Job|blowjob|blowjobs|blumpkin boy|boffing|boiolas|boll0ck|bollock|bollock*|bollockchops|bollocking|bollocks|bollocktician|bollok|bollox|bondage|boner|bonk juice|boob|boobs|booty|breasticles|breasts|bstrd|btch|buceta|bugger|bugger off|bull shit|bullshi|bullshit|bullshite|bum-bandits|bum-driller|bumhole|bung hole|bunny fucker|butt|butt fuck|butt fucker|butt hole|butt pirate|butt-fucker|butt-fuckers|butt-fucking-bandit|butt-munchers|butt-pirate|buttfuck|buttfucker|buttfuckers|butthead|butthole|butthole boy|buttlicker|buttmuch|buttplug|buttwipe|bwc|bzitch|c*ck|c*ckhead|c*cks*cker|c*cksucker|c*m|c*nt|c*ntface|c*nts|c*nty|c*um|c00n|c00nies|c0ck|c0ckhead|c0cks|c0cksuccer|c0cksucked|c0cksucker|c0cksuckers|c0k|c0x|c0xux0r|caaak|cabron|caca|cack|cagone|Camel jockey|cameltoe|Carpet Muncher|carpetmuncher|carpetmunchers|carpetmunching|cawk|cawk muncher|cawkmuncher|cawks|cawksucker|cazzo|cck|ch1nk|chaturbate|chesticles|china-virus|chinavirus|chinese-virus|chingchong|chink|chinky|choad nectar|chocha|choke the chicken|cholo|chraa|chuj|cipa|cl*t|cl1t|Clit|clitlickers|clitoris|clits|closet fuckhead|clusterfuck|clusterfucked|clusterfucker|clusterfucking|clusterfucks|cnnt|cnts|cntz|cnut|cobb knobbler|cock|cock droplets|cock head|cock jockey|cock knocker|cock licker|cock munch|cock rider|cock smoker|cock snot|cock suck|cock sucker|cock sucking|cock sucking boiolas|cock sucking nob jokeys|cock tease|Cock*|cock-face|cock-gobbler|cock-head|cock-sucker|cock-suckers|cockboy|cockeater|cockface|cockgobbler|cockh3ad|cockhead|cockheads|cockhed|cockholster|cockless|cocklicker|cockmonger|cockmunch|cockmuncher|cocks|cockshit|cockskin|cocksmoker|cocksplat|cocksucc|cocksuccas|cocksuccer|cocksuccers|cocksuck|cocksuckas|cocksucked|CockSucker|cocksuckers|cocksucking|cocksucking mothafuckers|cocksucks|cocksuk|cocksuka|cocsuck|cok|cokmuncher|coksucka|coolie|coon|coon1es|cooni3s|coonie|coonies|coons|coot|coot coot|cooter|cooter shooting|cooterpuffing|cotton picker|cr*phead|cr@p|crap|craphead|crazy mofos|crazy sob|creampie|crotch|crotch fiddler|crotchy|cuksuker|cuksukka|cum|cum goon|cumball|cumdump|cumdumpster|cumface|cumfreak|cumguzzler|cumhole|cummer|cumming|cumquatch|cumrag|cums|cumshot|cumslut|cumsocket|cumstain|cumwagon|cumz|cunilingus|cunt|cunt ass|cunt fart|cunt lick|cunt licker|cunt lips|cunt*|cuntasaurus rex|cuntbag|cuntbollock|cuntelope|cuntface|cunthead|cuntits|cuntless|cuntlick|cuntlicker|cuntlickers|cuntlicking|cuntness|cunts|cunty|cuntz|cyalis|cyberfck|cyberfcks|cyberfuc|cyberfuccs|cyberfuck|cyberfucked|cyberfucker|cyberfuckers|cyberfucking|cyberfucks|cyberfukk|cyberfukks|cyberfvcks|d!ck|d!cks|d!ld0|d!ldo|d*ck|d*ckhead|d*ldo|d*mbass|d*mn|d*ngleberry|d*pshit|d*uche|d*uchebag|d*uchecanoe|d0ggy style|d1ck|d1ckhead|d1ckheads|d1cks|d1cksucker|d1cksukka|d1ckz|d1ldo|d4mn|d@mn|dafuq|dago|damn|darkass|darkfuck|darkie|darkshit|darktard|darky|daygo|dck|dego|dick breath|dick face|dick fucker|dick head|dick licker|dick milker|dick nibbler|dick smoker|dick sucker|dick*|dick-face|dick-gobbler|dick-head|dickface|dickfucker|dickhead|dickheads|dickhole|dickjockies|dickless|dicklicker|dickmilk|dickmuncher|dicks|dickskin|dickslapper|dicksmoker|dicksucker|dickvag|dickwad|dickweasel|dickweed|dickz|dike*|dikhead|diks|dild0|dild0s|dildo|dildos|dingleberry|dipsh1t|dipsh1tty|dipshat|dipshidiot|dipshit|dipshite|dipshits|dipshitter|dipshitty|dirsa|dirty sanchez|dlck|dlcks|dmn|dog fuck|dog fucker|dog fucking|dog shit|dog's bollocks|dog-fucker|doggin|dogging|doggo style|doggy style|doggy_style|dogie style|dogsh1t|dogsh1ts|dogshit|dogshits|dogstyle|dominatricks|dominatrics|dominatrix|donkeyribber|doosh|dothead|double dick|double dicking|double-dong|douche|douche bag|douche canoe|douchebag|douchecanoe|douchewaffle|duche|dumasses|dumb bastard|dumb fucker|dumb-ass|dumb-shit|dumb@ss|dumbarrassed|dumbass|dumbass fucker|dumbass mofoes|dumbass mothafuckers|dumbass son-of-a-bitch|dumbasses|dumbfucks|dumbshit|dump a load|dune coon|dupa|dyke|dziwka|ejackulate|ejaculate|ejaculated|ejaculates|ejaculating|ejaculatings|ejaculation|ejakulate|enculer|f u c k|f u c k e r|f'ed|f'er|f**k|f*ck|f*ckbag|f*ckboy|f*ckface|f*cking|f*cktard|f*ckwit|f*ggot|f*ggt|f0ck|f0cked|f0cker|f0ckers|f4nny|f@ck|f@cker|f@g|f@gg0t|f@gging|f@ggot|f@gs|f@gshit|f@k|f_u_c_k|face fuck|fack|fackuhs|faen|fag|fag asses|fag bag|fag hag|fag queen|fag*|fag0t|fag1t|faget|fagging|faggit|faggo|faggot|faggot mofoes|faggot mothafuckers|faggot nob jokeys|faggot nobjockies|faggot son-of-a-bitch|faggoting|faggots|faggs|faggy|fagshit|fagz|faig|faigs|fanculo|fannyflaps|fannyfucker|fart|fart-fucker|fartknocker|fatass|fatasses|fccuker|fck|fck you|fcka|fckahz|fcked|fckedup|fcker|fckin|fcking|fckn|fckr|fcks|fcktard|fckyeah|fcuk|fcuked|fcukers|fcuking|fcuks|fcvking|feces|feck|feck arse|fecker|feg|felch|Felcher|felching|fellate|fellatio|fellatio aficionado|fellator|fggt|fick|ficken|finger fuck|fingerbanged|fingerfuck|fingerfucked|fingerfucker|fingerfuckers|fingerfucking|fingerfucks|fingerpop|fistfuck|fistfucked|fistfucker|fistfuckers|fistfucking|fistfuckings|fistfucks|fitt*|fkbny|fked|fker|fking|fkings|fkk|Flikker|focker|fook|fooker|fookuh|foreskin|fothermuckers|Fotze|Fu(*|fuc|fucca|fuccers|fuccing|fuccs|fuck arse|fuck face|fuck faces|fuck goblin|fuck head|fuck off|fuck up|fuck y0u|fuck you|fuck your|fuck your mother|fucka|fuckahs|fuckass|fuckasses|fuckaz|fuckbag|fuckball|fuckbasket|fuckboy|fuckbubble|fuckbucket|fucked|fucked up|fuckem|fucker|fucker off|fuckers|fuckface|fuckfaces|fuckfest|fuckhead|fuckheaded|fuckheads|fuckhole|fuckin|fucking|fucking A|fucking asshole|fucking bastard|fucking hell|fucking me|fucking retard|fucking shit|fuckings|fuckingshitmotherfucker|fuckknuckle|fuckless|fuckmachine|fuckme|fuckmeat|fucknugget|fucknut|fucknuts|fuckpig|fuckpuppet|fucks|fuckshit|fuckshitface|fuckshithead|fuckstar|fuckster|fuckstick|fucktard|fucktards|fuckup|fuckwad|fuckwhistle|fuckwhit|fuckwhore|fuckwit|fucx|Fudge Packer|fudgefucker|fudgepacker|fudgepackers|fudgepackershitter|fudgepacking fucker|fugged|fugger|fuggerz|fuggings|fugly|fuk|fuk*|fuk1n|fuk1ng|Fukah|fukcs|Fuken|fuker|fukheads|Fukin|fuking|fukka|fukked|fukkers|fukkings|fukkuh|fuks|fuku|fukwhit|fukwhore|fukwit|full of shit|funbags|fuq|futhamucka|futkretzn|fux|fux0r|fvck|fvck you|fvcka|fvcker|fvckers|fvckin|fvcking|fvckwhi|fxck|fxcked|fxcker|fxcking|g*atf*cker|g*ddammit|g*ddamn|g00k|g0ddamn|g0ddamned|g0ddamnit|g@y b1tch|g@ylord|g@yshit|gangbang|gangbanged|gangbangs|gash-stabber|gaylord|gaylords|gaysex|gaytard|geebag|gin jockey|girlieboy|girly bits|girlyboy|go fuck yourself|go to hell|goatfucker|goatse|gobshite|god dammit|god damn|god damn it|god damned|god damnit|god-dam|God-damned|godamnit|godd@amn|godd@mnit|goddammit|goddamn|goddamn mothafuckers|goddamn son of a bitch|goddamn son-of-a-bitch|goddamned|gooch|gook|gowl|groid|groper|guiena|h*ll|h*rseh*t|h00r|h0ar|h0re|h4x0r|hang urself|hang yourself|hardcoresex|harry palms|heeb|hells|helvete|higg3r|higg@|higga|higger|higgers|hoar|hoare|hoe-asses|hoebag|hoer|hoer*|hoes|holy fuck|homo asses|homos|honkey|hooker|hoor|hoore|hope you die|horniest|horny|horseshit|hotsex|Huevon|injun|j*ckass|j*ckoff|j*goff|j*rk|j*sm|j*zz|j*zzmopper|j-offs|j3rk|ja!lbait|ja1lbait|Jack off|jack-ass|jack-off|jack-offs|jackarse|jackass|jackasses|jackhole|jackoff|jackoffs|jackoffz|jagoff|jailba!t|jailbait|jap|japs|jerk|jerk off|jerk-0ff|jerk-0ffs|jerk-off|jerk-offs|jerking off|jerkoff|jerkoff jerking off|jerkoffs|jerks off|jewboy|jigaboo|jigaboos|jigga|jiggabooboo|jiggabu|jiggas|jiggerboo|jiggerboos|jiggs|jiggyboo|jigro|jisim|jism|jiss|jiz|jizm|jizz eater|jizz licker|jizz-jockey|jizzbags|jizzed|jizzes|jizzface|jizzfucker|jizzing|jizzmopper|jizzsacks|jizzstain|jizzy|k!k3|k!ke|k*ob|k*ock|k..!ke|k1k3|k1ke|kanker*|kawk|kid diddler|kiddy touch|kike|kikes|kiss ass|kiss my ass|kitty puncher|kkk|klitoris|klootzak|kn*b|kn*bhead|kneegrows|knob eater|knob gobbler|knob jockey|knob-face|knob-gobbler|knob-head|knob3d|knob3nd|knobd|knobe|knobead|knobeads|knobed|knobeds|knobend|knobender|knobends|knobendy|knobendz|knober|knobes|knobgobbler|knobhead|knobheads|knobjockies|knobjocky|knobjokey|knobjokeys|knobz|knt|knulle|kock|kondum|kondums|ku kluxer|kuk|kuksuger|kum|kummer|kumming|kums|kunilingus|kunt|kunts|kuntz|Kurac|kurwa|kusi*|kyke|kyrpa*|l*mp d*ck|l*rdass|l3i + ch|l3i+ch|l3itch|l3itches|l@dyb0i|l@dyb0y|l@dyboy|labia|ladboys|ladboyz|ladiboy|lady-boy|ladyb0i|ladyb0y|ladyboyz|lardass|lesbo|Lezzian|limp dick|lubetube|m*therf*cker|m*therf*cking|m0f0|m0f0s|m0fo|m0foes|m0fos|m0ng0l0id|m0ngoloid|m45terbate|m@asterbated|ma5terb8|ma5terbate|mamhoon|manseed|markasses|massterbait|masstrbait|masstrbate|master-bate|masterb8|masterbaiter|masterbat*|masterbat3|masterbate|masterbates|masterbation|masterbations|masturbat*|masturbate|matureporn|maturesex|maturetube|meat curtains|meat-sword|mecha fag|mega fag|merd*|mf'er|mf'ers|mf'ing|mfckers|MFer|MFers|mfing|mfk|mfs|mfukk|mfukker|milf|mindfuck|mo-fo|mof0|mof0es|mof0s|mofcker|mofo|mofo ass|mofoes|mofos|mofoshit|mofuccers|mofucckers|mofuck|mofucker|mofuckkas|mofuk|mofukkas|molester|mongoloid|Motha Fucker|Motha Fuker|Motha Fukkah|mothafuck|mothafucka|mothafuckas|mothafuckaz|mothafucked|mothafucker|mothafuckers|mothafuckin|mothafucking|mothafuckings|mothafucks|Mother Fucker|Mother Fukah|Mother Fuker|mother-fucker|motherfuck|motherfucked|motherfucker|motherfuckers|motherfuckin|motherfucking|motherfuckings|motherfuckka|motherfucks|mouliewop|muie|mulkku|muschi|mutha|Mutha Fucker|Mutha Fukah|Mutha Fuker|muthafecker|muthafuckker|muther|mutherfucker|n*mbnuts|n*ts|n0bhead|n0bj0cky|n1ckker|n1g3r|n1g3rz|n1gg3rs|n1gg@|n1gg@hs|n1gga|n1ggah|n1ggahs|n1ggas|n1ggazes|n1gger|n1ggers|n1gguh|n1gr|n3gro|nastt|negga|neggar|negr0|negroid|nepesaurio|niccer|nicka|nickas|nicker|nickk3r|nig|nig-nog|niga|nigah|nigasses|nigers|nigg3r|nigg3rs|nigg4h|nigg4hs|nigg@|nigg@hs|nigg@s|nigg@z|nigg@zzes|nigga lover|niggahs|niggahz|niggas|niggaz|niggazzes|nigger|nigger lover|nigger*|nigger;|niggerz|niggir|niggress|nigguh|nigguhs|nigguhz|niglet|nignigs|nignog|nigra|nigre|nigs|nigur;|niigr;|nikk3r|nikkas|nikker|nob jockey|nob jokey|nob jokeys|nobbyhead|nobhead|nobheads|nobj0key|nobjockies|nobjocky|nobjokey|nobjokeys|nuckas|numbnuts|nutjob|nutsack|nutsacks|nympho|nymphomaniac|octopussy|orafis|orgasim|orgasim;|orgasims|orgasm|orgasms|orgasum|oriface|orifiss|orospu|oven dodger|p*rn|p*ss|p*ss off|p*ssflaps|p*sshead|p*sspants|p*sspot|p*ssy|p0rn|p3n1shead|p3nisfcker|p3nisfcukers|p3nisfvcker|p3nisfvckers|p@ss|pack my fudge|packerfudgehead|packi|packie|packing fudge|packing fudgehead|packingfudge|packingfudgefucker|packingfudgefucking|packsomefudgefucker|packy|paki|pakie|paky|palm jockey|pancake face|paska*|pecker|peckerhead|pedo|pedobear|pedobears|pedophl|pedos|pedoz|peeenus|peen|peener|peinus|pen1s|penas|penis|penis-breath|penisfcker|penisfuccer|penisfucker|penisfuckers|penisfvcker|penisfvckers|penishead|perse|ph@ggots|phaggot|phaggots|phags|phonesex|Phuc|phuccer|phucchead|phuccing|Phuck|phuck3r|phucked|phucker|phuckin|phucking|phuckings|phucks|phucup|Phuk|phuked|phukeds|Phuker|phukhead|phuking|phukings|phuks|phukshit|phuku|phukup|phuq|phuqs|phvckings|picka|pierdol*|pig fucker|pigfucker|pigfuckers|pigfucking|pigfukker|piggyfuck|pigshit|pillow biter|pillow-biter|pillu*|pimmel|pimpis|piss|piss face|piss off|piss off fuckhead|piss shit|piss*|pissed|pisser|pissers|pisses|pissflaps|pisshead|pissin|pissing|pissmonger|pissoff|pissoffs|pisspants|pisspot|pissrag|pizda|polac|polack|polak|pole licker|pole smoker|pole sucker|polesmoker|Poonani|poontsee|poop|porch monkey|porn|pornhub|porno|pornography|pornos|pr*ck|pr0n|pr1c|pr1ck|pr1k|prck|prckr|prick|prick-face|prick-gobbler|prick-head|prickface|pricks|pron|pss|pssy|pu$sy|pu55y|pube|pula|pule|pull the pud|punani|punk ass mofoes|punk-ass|punkasses|puss|pusse|pusses|pussi|pussie|pussies|pussless|pusslicker|pussy|pussy fucker|pussy lick|pussy licker|pussy licking|pussylickers|pussys|pussywhipped|puta|puto|puuke|puuker|puzzies|puzzy|qahbeh|queef|queef*|qweir|r3t@rd|r3t@rded|r3tard|raghead|ragheads|ragtard|rap3|rap3d|reacharound|recktum|redskin|redtube|retard|retardo|retardotron|rice monkey|rim job|rimjaw|rimjob|rimming|s hit|S&M|s*d|s*d off|s*n of a b*tch|s*n of a wh*re|s-lut|s.o.b.|s.o.b.s|s/h/i/t|s_h_i_|s_h_i_s|s_h_i_t|sand nigger|sc*mbag|scamfuck|scank|scheiss*|schlampe|schlong|schmuck|scroat|scrote|scrotum|scumbag|scumfuck|scumfucker|scumfvck|scummy|scut|semen|sexaraby|sexsaoy|sexy|sh! +|sh!+|Sh!t|sh!t*|sh*t|sh*tbag|sh*te|sh*teater|sh*tfaced|sh*thead|sh*theel|sh*tshow|sh*tstorm|sh*tter|sh*tty|sh1s|sh1t|sh1t3|sh1td1ck|sh1tdick|sh1te|sh1ter|sh1tfuck|sh1th3ad|sh1theads|sh1ts|sh1tsome|sh1tty|sh1tz|sh3mal3|sh3male|shag|shagger|shaggin|shagging|sharmuta|sharmute|shat|she-male|sheister|shemal3|shemale|shemales|shi+|shi+e|shi+y|shiat|shiddick|shiester|shiesterfuck|shiesterfuckface|shiesterfuckhead|shiesterfucks|shipal|shipdit|shit face|shit for brains|shit fuck|shit fucker|shit head|shit licker|shit stain|shit-arse|shit-ass|shit-bag|shit-bandit|shit-fucker|shit-stuffers|shit3|shitass|shitasses|shitassfucker|shitassfuckface|shitbag|shitbird|shitblimp|shitblimps|shitbrain|shitcock|shitd1ck|shitdick|shitdicks|shitdikk|shitdip|shite|shiteater|shiteblimps|shited|shitedick|shitefuck|shitefulls|shitehawk|shitehead|shites|shitey|shitface|shitfaced|shitfacefuck|shitfacefucker|shitfck|shitfk|shitfreak|shitfuck|shitfucker|shitfuckhead|shitfuckmotherfucker|shitfucks|shitfudgefucker|shitfull|shitfvck|shithead|shitheadfucker|shitheadfuckface|shitheads|shitheel|shithole|shiting|shitings|shits|shitsdick|shitsfuck|shitsful|shitshow|shitstain|shitstorm|shittastic|shittasticfuck|shitter|shitterfucker|shitters|shitti|shitties|shittiest|Shitty|shitty mofoes|shittydick|shittydicks|shittyfuck|shittyfuckface|shittyful|shitweasel|shitz|shiz|shlong|shmale|sht|shtfuk|shut the fuck up|Shyt|Shyte|shytfeisterfuck|Shytty|sissy|sixty-nine|sk*nk|sk@nks|sk@nky|sk@nkz|skanck|skank|skankee|skankey|skanks|Skanky|skankz|skribz|skurwysyn|sl*t|sl*tty|sl@nteye|slantard|slanteye|slanteye b1tch|slanteyes|slanteyeshit|slantfreak|slanty|slut|slut hole|slutbag|sluts|Slutty|slutz|sm*ghead|smeghead|smegma|smut|snatch licker|soab|sod off|son o bitch|son of a bitch|son of a whore|son-of-a-bitch|sonna bitch|sonofabitch|sonofbitches|sons of b1tches|sons of bitches|sons-of-bitches|sonz of bitchez|soppy bollucks|sp*nk|spac|spanking|sperm|sphencter|sphincter|spic|spicfuck|spick|spics|spicshit|spierdalaj|spig|spik|spix|splooge|stfu|stump chewer|stupid fucker|stupid hoe|stupidasses|suck my cock|suck my d|suck my dick|suck off|suck-ass|suka|sum of a bitch|sumbitch|t*rd|t*sser|t*t|t*tty|t1tt1e5|t1tties|tadger|taking the piss|tallywacker|tar-baby|tard|tard asses|teets|teez|testical|testicle|testicle*|throat yogurt|throater|tickle the pickle|timber nigger|titfuck|tits|titt*|tittie5|tittiefucker|titties|titty|tittyfuck|tittywank|titwank|tosser|tossing salad|towelhead|towelheads|towelshithead|Tranny|trouser snake|trousersnake|tube8|turd|turdcutter|turdhead|tw*t|tw4t|tw@t|twa+|twat|twat waffle|twatface|twathead|twats|twattish|twatty|twatzilla|twunt|twunter|upskirts|v14gra|v1gra|va1jina|vag|vag1na|vagiina|vaj1na|vajayjay|vajina|vittu|vullva|w*anker|w*nk|w*nker|w*nkstain|w00se|w0p|w4nk3r|w4nker|w@nker|w@nkers|wang wrangler|wank|wank off|wank*|wank3r|wank3rs|wankbastard|wanked|wanker|wankers|wankface|wankies|wanking|wankmagnet|wanks|wankstain|wanky|we1back|weenie|wet back|wetback|wetback*|wetbacks|wh*re|wh00r|wh0r3|wh0re|wh@re|whack off|what the fuck|whoar|whoars|whor3|whore|whorebag|whores|wichser|wigger|willy-whacker|window licker|wise ass|wnker|wop|wop*|wophead|xhamster|xnxx|xrated|xvideo|xxx|youporn|zabourah|zip in the wire|zipperhead|احا|احه|احيه|اخو القحبه|اغتصاب|افسخك|اقلب وجهك|الاغتصاب|الاير|البخش|البز|البزاز|البظر|البيضان|التمص|الثدي|الجماع|الحلمه|الخرائ|الخول|الزب|السافل|الساقط|السحاق|السحاقيه|السكس|الشرج|الشرموطه|الشهوه|الطيز|الطيزو|الطيزي|العاهره|العرص|الفشخه|القحبه|القضيب|الكحبه|الكس|الكسي|الكلب|اللبوه|اللحس|اللعق|اللواط|اللوطي|المتناك|المتناكه|المص|المفلقسه|الممحونه|النيك|انتاك|انذال|انذل|انكح|انكحك|انيك|اهبل|اير|ايري|ايور|بخش|بخشي|بز|بزاز|بظر|بعبص|بعص|بغاي|بهيمه|بيضان|تجليخ|ترهيط|تزغيب|تسد بوزك|تفو|تمص|ثدي|جلخ|جلق|جماع|حقير|حلبتها|حلبتو|حلمات|حمير|خرا|خراء|خراي|خرايا|خره|خرى|خسيس|خنيث|خوازيق|داشر|داعر|دعاره|دلخ|ديوث|ديود|زاكا|زامل|زب|زبار|زبر|زبه|زبي|زراط|زق|زناطير|زناه|سارموتا|سافل|سحاق|سحاقيه|سربوط|سرموتا|سفاله|سكس|سكسي|سيكس|سيكسي|شرج|شرمها|شرموط|شلقه|شلكه|شهوه|صايع|صرمك|صياعه|ضرب عشره|طز في|طيز|طيزا|طيزو|طيزي|عاهر|عاهره|عايبه|عبيط|عكروت|غتصب|فاجر|فسختها|فشخ|فشخه|قحاب|قحب|قحبه|قضيب|قضيبي|قواد|كحبه|كس|كسختك|كسمك|كسمكم|كسها|كسي|كلاب|كلب|كلخر|لبوه|لحس|لعق|لعين|لقحاب|لواط|لوطي|مبعوص|متخوزق|متناكه|مخانيث|مخنث|مص|معوهر|مفسوخ|مفلقسه|مكسكس|مكوتها|ملحات|ملعون|ممحون|ممحونه|منايك|منيك|منيوك|ناكك|نايك|نذل|نفضك|نفظك|نياكه|نيك|هنيكك|وسخه|يتناك|يزغب|يلعن|يلعنك|👉👌|🖕|خولات|وخولات|الخولات|والخولات|للخولات|متناكين|ومتناكين|المتناكين|والمتناكين|للمتناكين|والمنيوك|منيوكه|ومنيوكه|المنيوكه|للمنيوكه|والمعرص|معرصه|ومعرصه|المعرصه|والمعرصه|للمعرصه|معرصين|ومعرصين|المعرصين|والمعرصين|للمعرصين|تعريص|وتعريص|التعريص|والتعريص|للتعريص|يعرص|ويعرص|تعرص|وتعرص|يعرصوا|ويعرصوا|والشرموط|شراميط|وشراميط|الشراميط|والشراميط|للشراميط|شرمطه|وشرمطه|الشرمطه|والشرمطه|للشرمطه|والقحاب|قحايب|وقحايب|القحايب|والقحايب|قحابي|وقحابي|القحابي|والقحابي|يا علق|ولاد الجحبه|ياعلق|ياكس امك|يابن المومس|ياولاد الجحبه|يابنت القحوب|بن الزانيه|لمنيوجه|القحوب|كسمه|وكسمه|كسم|وكسم|كسك|زبري|كسمين|كسمها|طيزك|زوبري|ابعبص|طيزه|طيزها|ولطيزك|هبعبصك|بتعرص|وبتعرص|بيعرص|وبيعرص|بيعرصوا|وبيعرصوا|بتعرصوا|وبتعرصوا|كسمهم|يقحبه|تنيك|بلامنيكه|منيكه|طيازك|ينيك|وينيك|بينيكك|لكسم|لكسمه|بتعرصلهم|هعرصلك|بتتناك|اتناكت|الخولنه|بعبصه|انيكه|تتناكوا|اتناكوا|بيعرصلها|تعريصك|ناكها|وينيكني|زبرين|ينيكه|وطيزها|بطيزها|زوبر|بطيزج|وتتناك|نيكني|بن الاحبه|قحوب|يالقحبه|ينيكني|ياخول|ياخولات|يامتناك|يامتناكه|يامتناكين|يامنيوك|يامنيوكه|ياعرص|يامعرص|يامعرصه|يامعرصين|ياشرموط|ياشرموطه|ياشراميط|ياقحبه|ياقحاب|ياقحايب|ياقحابي|ياكسمك|يابن الزانيه|يالمنيوجه|يالقحوب|وطيزك|أزبار|طياز|عاهرات|بنت حرام|ابن الزنا|ابن الزانية|ابن الكلبة|عيال الحرام|شخة|شخاخ|ابو شخة|بهايم|بهيم|بغل|كلبه|كلبين|خنزير|خنزيره|خنازير|حماره|منيل|منيله|منيلين|متخلف|متخلفه|متخلفين|معفن|معفنه|معفنين|حثاله|ندل|ندال|اندال|ندله|وقح|وقحه|وقحين|بجح|بجحه|سفله|حقيره|خسيسه|خسيسين|واطيه|واطين|غبيه|اغبياء|اغبي|اهبله|عبيطه|سافله|ساقطه|ساقطات|الساقطات|مومس|مومسات|المومس|بغايا|عهر|قرنان|قرنانه|ديوثه|دياثه|ديوثين|الديوثين|قوادين|قواده|القواد|داعره|هعرص|هتعرص|هيعرص|هتعرصوا|هيعرصوا|اعرص|عرصك|عرصين|اتعرص|خولك|بخولات|اتناك|اتناكي|هتتناك|هيتناك|بيتناك|تتناك|هتتناكوا|بيتناكوا|اتنيك|اتنيكي|متنيك|قحبات|قحبتك|قحباتي|شرموطات|شرموطتك|شرمط|شرمطها|شرمطتك|شرموطك|شرموطتي|لبوات|كسهم|كسكم|كسمو|كسمكو|كسمكوا|كسامك|كسام|زبك|زبها|زبهم|زبرك|زبره|زبرها|زبرهم|طيزهم|طيزكم|بزازي|بزازك|بزازها|بزازه|بزازهم|نيكه|نيكها|نيكهم|نيكوا|نيكتها|نيكتك|ناكه|ناكوك|ناكتها|ناكو|هنيكها|هنيكه|هنيكو|هنيكوا|بنيك|بينيكها|ينيكها|ينيكم|اجلخ|اجلق|جلاخ|جلاق|تجلخ|تجلق|يجلخ|يجلق|بيجلخ|بيجلق|بتجلخ|بتجلق|هجلخ|هجلق|بعبوص|بعبوصه|يبعبص|بيبعبص|هبعبص|اتبعبص|تبعبص|بعبصتك|بعبصتها|مبعبص|هفشخك|هفسخك|افشخك|هفشخه|هفسخه|فشخت|فشختك|شخ|شخي|شخيت|هشخ|اشخ|يشخ|بيشخ|بورنو|بورنهب|فاكينج|فاكنج|فوكينج|بيتشز|ماذرفاكر|موذرفاكر|كس امك|كس امكم|كس امه|كس اختك|كس اختكم|كس خالتك|كس عمتك|كس ام|كس ام اللي|يلعن ابوك|يلعن ابوكي|يلعن ابوكم|يلعن ابو|يلعن امك|يلعن امكم|يلعن اختك|يلعن ابو امك|يلعن ابو اللي|يحرق ابوك|يحرق امك|ابن ستين كلب|ولاد ستين كلب|بنت ستين كلب|ابن ستين في سبعين|ستين كلب|بستين نيله|ستين نيله|منيل بستين نيله|يا جزمه|ياجزمه|ابن الجزمه|بنت الجزمه|ولاد الجزمه|ابن العاهره|ابن القحبه|ابن المومس|ابن الجحبه|ابن زانيه|ابن زنا|ابن وسخه|ابن وسخ|ابن كلب|ابن حرام|ابن كلبه|بنت الكلب|بنت الكلبه|بنت الوسخه|بنت المتناكه|بنت العاهره|بنت القحبه|بنت الزانيه|بنت الزنا|بنت كلب|ولاد الكلب|ولاد الكلاب|ولاد الحرام|ولاد الوسخه|ولاد الزنا|ولاد القحبه|ولاد العاهره|ولاد المتناكه|ولاد كلب|ولاد حرام|ولاد زنا|ولد الحرام|ولد الكلب|ولد الزنا|عيال الكلب|عيال الكلاب|عيل الحرام|عيل الكلب|اخو الشرموطه|اخو الشرموط|اخت القحبه|اخت الشرموطه|اخت المتناكه|اخو المتناك|اخو المتناكه|ام الشرموطه|ام القحبه|ام المتناكه|قليل الادب|قليله الادب|قليلين الادب|قله ادب|قله الادب|قليل الحيا|قليله الحيا|قليل الحياء|قليله الحياء|قله حيا|قله الحيا|عديم الادب|عديم الحيا|عديم الاخلاق|عديمه الاخلاق|عديم الشرف|عديمه الشرف|قليل الشرف|قليله الشرف|قليل الاصل|قليله الاصل|فاك يو|kosomak|kosom|kosomo|kosomha|kosomk|kosmak|ksomak|ksmk|ksmak|k0smak|kos omak|kos om|kos ommak|kos ekhtak|kos o5tak|kos okhtak|sharmoot|sharmouta|sharmota|sharamit|sharameet|metnak|mtnak|metnaka|mtnaka|metnakeen|mitnak|mitnaka|5awal|khwal|5wal|khawalat|5awalat|kh0wal|3rs|3arsa|mo3ars|mo3res|mo3rs|m3ars|t3rees|ta3rees|3arseen|a3ars|bet3ars|bt3rs|a7a|a7eh|a7h|neekak|neekha|neekmak|nekmak|hanikak|haneekak|hanekak|hnikak|anikak|anikha|nayek|naykak|ibn el kalb|ebn el kalb|ibn kalb|ebn kalb|ibn el wes5a|ebn el wes5a|ebn el wesekha|ibn el sharmouta|ebn el sharmouta|ibn el metnaka|ebn el metnaka|ebn el 3ahra|ibn el 3ahra|ebn el 7aram|ibn el 7aram|ebn el haram|ibn el haram|ayri|ayre|ayr|zobry|zobri|zobrak|zobr|zubri|tezy|tezak|tizak|tizha|tezha|bzazi|bzazy|hmar|7omar|ahbal|3beet|3abeet|3abit|ghabi|ghabya|ghabiya|wes5a|wesekh|wesikh|wesekha|wsekh|ws5|ws5a|7ayawan|hayawan|7ayawn|7ewan|zbala|waty|3ahra|3ahera|3ahira|mnyok|mnyoka|menyok|menyoka|mnyuk|جحش|جحشه|تيوس|رزل|رزله|رزيل|رزيله|قذره|وصخ|وصخه|ملعونه|ملاعين|ملعونين|لعينه|لعينين|ايره|ايرها|ايرهم|ايرنا|خصاوي|خصاويك|خصاويه|مصني|مصيني|امصني|امصها|امصلي|كحاب|كحبات|كحبتك|استمناء|الاستمناء|شهوانيه|عاده سريه|العاده السريه|بالعاده السريه|لواطي|لواطيين|لوطيين|اللوطيين|سحاقيات|سحاقي|نيجا|نيغا|نياك|نيكمك|نيكختك|نيك امك|نيك اختك|انيك امك|انيك اختك|هنيك امك|هنيك اختك|نيك ام|ينيك امك|ينيك ابوك|ناك امك|ناك اختك|انيك ابوك|نيك ابوك|نيك ابو|نيك مك|كس ام الدنيا|كس اللي خلفك|كس اللي جابك|يلعن شرفك|يلعن روحك|يلعن روح|يلعن اهلك|يلعن اصلك|يلعن عرضك|يلعن ابو شكلك|يلعن ابو ده|ابن اللبوه|ولاد اللبوه|ابن المنيوكه|ولاد المنيوكه|ابن المعرصه|ابن المعرص|ولاد المعرصه|ولاد المعرص|ابن الخول|ولاد الخول|ولاد العرص|ولاد المتناك|ابن المتناك|بنت المنيوكه|بنت اللبوه|بنت العرص|بنت الشرموطه|بنت الخول|بنت الكحبه|ابن الكحبه|ولد الكحبه|ولد القحبه|ولد الشرموطه|ولاد الكحبه|ولاد الشرموطه|ماذر فاكر|موذر فاكر|سن اوف ا بيتش|سن اف ا بيتش|سن اوف بيتش|جنس فموي|جنس شرجي|جنس جماعي|نيك شرجي|نيك فموي|نيك جماعي|kahba|kahbe|qahba|ka7ba|qa7ba|kahbeh|qa7beh|gahba|jahba|ga7ba|manyouk|manyok|manyuk|manyoukeh|6eez|6iz|6ez|6izk|6ezk|6izy|5ara|5ra|khra|ya kalb|ya kalba|ya hayawan|ya 7ayawan|ya hmar|ya 7mar|ks omk|kos omk|ks omak|ks om|assbag|assbanger|assbite|asscock|asscracker|assgoblin|asshead|asshopper|assjacker|asslick|asslicker|assmonkey|asspirate|asssucker|asswad|bampot|bastardo|bukkake|bulldyke|bunghole|buttmunch|choad|chode|circlejerk|cockbite|cockburger|cockjockey|cockknoker|cockmaster|cockmongler|cockmongruel|cockmonkey|cocknose|cocknugget|cocksmith|coochie|coochy|cornhole|cumbubble|cumjockey|cumtart|cunnie|cunthole|cuntrag|dickbag|dickbeater|dickjuice|dickmonger|dickslap|dickwod|doochbag|dumshit|fagbag|fagtard|fagg|fagot|fags|fcuker|felatio|gaybob|gaydo|gaywad|honky|jizz|jizzum|juggs|kiunt|kooch|kootch|kumer|lezzie|minge|muffdiver|nimphomania|panooch|poof|poonany|poontang|punanny|punany|pusies|pusy|queaf|quim|renob|shity|shitbagger|shitbreath|shitcunt|shiteating|shitfit|shithouse|shitload|shitpot|shitspitter|shiznit|spooge|thundercunt|tubgirl|twatlips|vjayjay|nigga|fucc|fuccboi|fuckboi|fuckery|shitlord|twatwaffle|dickwaffle|cockwomble|pissant|jackwagon|bullshitter|chickenshit|ratfuck|cumwhore|fucktoy|cockslut|whorish|thot|thots|bitchboy|cumbucket|jizzrag|godamn|fkn|fkin|fkng|fukn|cuck|cucks|retarded|retards|wanksta|kys|dumbfuck|shitposter|cockwaffle|spunkbubble|knobjockey|tarbaby|sandnigger|porchmonkey|spearchucker|chinaman|pikey|gyppo|jungle bunny|coon ass|dumb fuck|dumb ass|kill yourself|go kill yourself|putas|putos|pendejo|pendeja|cabrona|culero|culera|verga|chingada|chingar|chingado|hijueputa|hdp|mierda|carajo|gilipollas|cojones|joder|zorra|marica|maricon|joto|caralho|foda|fodase|puttana|hijo de puta|hija de puta|chinga tu madre|vete a la mierda|filho da puta|foda-se|vai se foder|vai tomar no cu|putain|merde|connard|connasse|salope|salaud|encule|enculé|nique|niquer|ntm|fdp|pute|couille|couilles|branleur|scheisse|scheiße|hurensohn|wichsen|scheisskerl|godverdomme|vaffanculo|stronzo|stronza|minchia|troia|merda|nique ta mere|nique ta mère|fils de pute|va te faire foutre|fick dich|halt die fresse|va fanculo|blyat|blyad|blyadina|pizdec|zalupa|mudak|gandon|yebat|ebat|yobany|nahuy|nahui|cyka|cyka blyat|idi nahui|idi nahuy|pierdole|pierdolic|jebac|jebany|amk|oruspu|sikik|siktir|yarrak|yarak|ibne|pezevenk|gavat|anani|sikerim|sikeyim|orospu cocugu|orospu çocuğu|amina koyim|amina koyayim|bhenchod|behenchod|madarchod|maderchod|chutiya|chutia|gandu|bhosdike|bhosdi|bhosda|randi|bangsat|kontol|memek|ngentot|jancok|jancuk|pantek|caonima|nmsl|wdnmd|shabi|tamade|cao ni ma|sha bi|ta ma de|wo cao|كسماك|كسخالتك|كسعمتك|كسعمك|بيتعرص|يتعرص|تعرصوا|تعرصي|خولين|خولنه|تشرمط|متشرمط|متشرمطه|شرموطتها|منياك|طيازه|طيزين|طيازي|طيازها|كشمك|كصمك|كسمخ|كسمق|غرص|جحبه|فحبه|سرموطه|سرموته|شرموته|سرموط|شرموت".split('|');
  Object.freeze(BAD_WORDS);
  const AR = /[\u0600-\u06FF]/;
  // invisible / control characters people hide inside words (zero-width, Hangul filler, braille blank, C0/C1 controls)
  const IGN_CLS = '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u3164\\u115F\\u1160\\uFFA0\\u2800\\u180E';
  const IGN = new RegExp('[' + IGN_CLS + '\\p{Cf}]', 'gu');
  const TOKEN = new RegExp('[\\p{L}\\p{N}\\p{M}\\p{Cf}ـ\\u{1F150}-\\u{1F189}\\u{1F1E6}-\\u{1F1FF}\\u24B6-\\u24E9' + IGN_CLS + ']+', 'gu');
  // Cyrillic / Greek look-alikes (only applied to tokens that also contain a Latin letter, so real Russian/Greek words are untouched)
  const HOMO = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','і':'i','ј':'j','ѕ':'s','һ':'h','к':'k','м':'m','т':'t','н':'h','α':'a','ε':'e','ο':'o','ρ':'p','ν':'v','ι':'i','κ':'k','τ':'t','υ':'u','χ':'x','η':'n' };
  const HOMO_RE = /[аеорсхуіјѕһкмтнαεορνικτυχη]/g;
  // Unify look-alike letters, drop accents/diacritics/tatweel/invisible chars (fúck, f̶u̶c̶k, ك‌س, شَرْمُوطَه).
  // small-caps / script-f, and extended Arabic letters (Persian, Urdu, Pashto, Sindhi...) folded to their plain Arabic letter
  const SC_FROM = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢƒɡ', SC_TO = 'abcdefghijklmnoprstuvwyzfg';
  const EXT = {};
  [['ڪڭݣګڬڮݢ','ك'],['ٮڀݐݒݔ','ب'],['ٹٺټٿ','ت'],['ڈډڊڋڌڍڎڏڐ','د'],['ڑڒړڔڕږ','ر'],['ڙ','ز'],['ښڛ','س'],['ڜ','ش'],['ڨٯڧ','ق'],['ڡڢڣڥڦ','ف'],['ںڻڼڽݨ','ن'],['ۋۆۇۈۉۊۏ','و'],['ڃڄچڇ','ج'],['ڂ','خ'],['څ','ح'],['ڸڵڶڷ','ل'],['ۀ','ه']]
    .forEach(([f, t]) => { for (const ch of f) EXT[ch] = t; });
  const EXT_RE = new RegExp('[' + Object.keys(EXT).join('') + ']', 'g');
  const clean = s => {
    let c = String(s).normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase()
      .replace(/[\u{1F150}-\u{1F169}]/gu, ch => String.fromCharCode(97 + ch.codePointAt(0) - 0x1F150))
      .replace(/[\u{1F170}-\u{1F189}]/gu, ch => String.fromCharCode(97 + ch.codePointAt(0) - 0x1F170))
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ch => String.fromCharCode(97 + ch.codePointAt(0) - 0x1F1E6))
      .replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢƒɡ]/g, ch => SC_TO[SC_FROM.indexOf(ch)])
      .replace(EXT_RE, ch => EXT[ch])
      .replace(IGN, '').replace(/ـ/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/[ىیېے]/g, 'ي').replace(/[ةەہۃھ]/g, 'ه')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ک/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب');
    if (/[a-z]/.test(c)) c = c.replace(HOMO_RE, ch => HOMO[ch]);
    return c;
  };
  // n  : Arabic letters fully de-stretched; Latin keeps legitimate double letters (ass, butt) so "but"/"as" stay clean.
  // n1 : fully de-stretched, used only to catch real elongation (fuuuck, كسسسمك).
  const keys = c => ({
    n: AR.test(c) ? c.replace(/الل/g, 'ا\uE000').replace(/([\p{L}\p{N}])\1+/gu, '$1').replace(/\uE000/g, 'لل') : c.replace(/([\p{L}\p{N}])\1{2,}/gu, '$1$1'),
    n1: c.replace(/([\p{L}\p{N}])\1+/gu, '$1')
  });
  const stretched = t => /([\p{L}\p{N}])\1\1/u.test(t.c) || (/([\p{L}\p{N}])\1/u.test(t.c) && t.n1.length >= 5);
  const words = new Map(), phrases = new Map(), literal = [], latin = [];
  BAD_WORDS.forEach(w => {
    const c = clean(w), k = keys(c);
    if (k.n1.length === 1) { literal.push(w); return; }
    if (/[^\p{L}\p{N}\s]/u.test(c)) { literal.push(w.normalize('NFKC').toLowerCase()); return; }
    if (c.includes(' ')) {
      const p = c.split(/\s+/).map(keys);
      if (!phrases.has(p[0].n1)) phrases.set(p[0].n1, []);
      phrases.get(p[0].n1).push(p);
      const g = c.replace(/\s+/g, '');                       // the same phrase typed without spaces
      if (g.length >= 5) { const kg = keys(g); if (!words.has(kg.n1)) words.set(kg.n1, new Set()); words.get(kg.n1).add(kg.n); }
    } else {
      if (!words.has(k.n1)) words.set(k.n1, new Set());
      words.get(k.n1).add(k.n);
      if (/^[a-z]+$/.test(c)) latin.push(c);
    }
  });
  for (const a of phrases.values()) a.sort((a, b) => b.length - a.length);
  const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literalPattern = literal.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + literal.sort((a, b) => b.length - a.length).map(s => Array.from(s).map(c => /[\p{L}\p{N}]/u.test(c) ? quote(c) + '+' : quote(c)).join('')).join('|') + ')(?![\\p{L}\\p{N}])', 'giu') : null;
  const same = (t, p) => t.n === p.n || (t.n !== t.n1 && t.n1 === p.n1 && stretched(t));
  const hit = t => { const s = words.get(t.n1); return !!s && (s.has(t.n) || (t.n !== t.n1 && stretched(t))); };
  // Egyptian clitics: يا / و ف / ب ل ك ال (e.g. ياكلب، وبالكلب، للخول)
  const P1 = ['', 'يا'], P2 = ['', 'و', 'ف'], P3 = ['', 'ب', 'ل', 'ك', 'ال', 'بال', 'لل', 'كال'];
  // glued address / kinship words in front of a bad word: انتعرص، ابنكلب، ولادكلب (remainder must be 3+ letters)
  const KIN = ['انتي', 'انت', 'ابن', 'بنت', 'بن', 'ولاد', 'اولاد', 'عيال', 'اخو', 'اخت'];
  function stems(n) {
    const out = [];
    for (const a of P1) if (n.startsWith(a)) for (const b of P2) if (n.startsWith(a + b)) for (const c of P3) {
      const p = a + b + c;
      if (p && n.startsWith(p) && n.length - p.length >= 2) out.push(n.slice(p.length));
    }
    if (n.startsWith('يا') && n.length > 3) out.push(n.slice(1)); // يابن -> ابن
    for (const b of [n, ...out]) for (const p of KIN) if (b.startsWith(p) && b.length - p.length >= 3) { const r = b.slice(p.length); out.push(r); if (r.startsWith('ال') && r.length >= 5) out.push(r.slice(2)); }
    return out;
  }
  // pronoun suffixes on a bad root: كلبك، خولك، عرصها، عرصهم (root >= 3 letters; short roots and names stay explicit-only)
  const SUF = ['كم', 'ها', 'هم', 'ك', 'يا'];
  const SUF_BLOCK = new Set(['اير']);
  const hitAr = t => {
    if (hit(t)) return true;
    if (!AR.test(t.n)) return false;
    for (const s of [t.n, ...stems(t.n)]) {
      if (s !== t.n && hit({ c: s, ...keys(s) })) return true;
      for (const f of SUF) {
        if (s.endsWith(f) && s.length - f.length >= 3) {
          const r = s.slice(0, -f.length);
          if (f === 'يا' && r.length < 4) continue;
          if (!SUF_BLOCK.has(r) && !(r.length <= 4 && r.endsWith('ي')) && hit({ c: r, ...keys(r) })) return true;
        }
      }
    }
    return false;
  };
  const LK = { l: 'ا', i: 'ا', o: 'ه', s: 'س', k: 'ك', m: 'م' };
  function forbidden(t) {
    if (hitAr(t)) return true;
    if (/[\u0621-\u064A]/.test(t.c) && /[0-9٠-٩a-z]/.test(t.c)) {
      const alts = [];
      if (/[0-9٠-٩]/.test(t.c)) { // digits hidden inside an Arabic word: ك0س، كس2مك، شرموط٥ (٥ looks like ه)
        alts.push(t.c.replace(/[0-9٠-٩]+/g, ''));
        if (t.c.includes('٥')) alts.push(t.c.replace(/٥/g, 'ه').replace(/[0-9٠-٩]+/g, ''));
      }
      if (/[a-z]/.test(t.c)) alts.push(t.c.replace(/[lioskm]/g, ch => LK[ch]).replace(/[a-z0-9٠-٩]+/g, '')); // Latin look-alikes: كلبl، شرموطo
      for (const c2 of alts) if (c2.length >= 2 && hitAr({ c: c2, ...keys(c2) })) return true;
    }
    return false;
  }
  // Several bad words / fillers typed with no spaces at all: كسامكياشرموط، انتتخول
  const FILL = new Set(['يا', 'انت', 'انتي', 'ابن', 'بنت', 'ولاد', 'اولاد', 'يلعن', 'ال', 'و', 'ف', 'ب', 'ل', 'ك']);
  function segHit(n) {
    const memo = new Map();
    const go = i => {
      if (i === n.length) return 0;
      if (memo.has(i)) return memo.get(i);
      let best = -1;
      for (let j = i + 2; j <= n.length; j++) {
        const part = n.slice(i, j);
        const kind = (part.length >= 3 && hit({ c: part, ...keys(part) })) ? 1 : (FILL.has(part) ? 0 : -1);
        if (kind < 0) continue;
        const r = go(j); if (r >= 0 && r + kind > best) best = r + kind;
      }
      memo.set(i, best); return best;
    };
    return go(0) >= 1;
  }
  // Latin-only extras: censor-style stars (f*ck, s**t, f***), vowel-less spellings (fck, sht, btch, cnt), profanity glued inside long tokens (fuckthisshit)
  const BYLEN = new Map();
  for (const w of latin) { if (!BYLEN.has(w.length)) BYLEN.set(w.length, []); BYLEN.get(w.length).push(w); }
  // curated vowel-less spellings only (generic skeletons collided with blt / plc / pts / rfc and "cnt" = can't)
  const SKEL = new Set('fck fcks fckn fcking fckr fckwt sht shts shtty btch btchs btchy dck dcks cck ccks pssy bstrd nggr nggrs fggt fggts mthrfckr mthrfckn'.split(' '));
  const ROOTS = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'whore', 'asshole', 'cocksuck'];
  const EMB_OK = /snigger|scunthorpe|cunthorp|shiitake|shitake|mishit|lipschitz/;
  const latinExtra = t => {
    if (AR.test(t.c)) return false;
    if (/^[b-df-hj-np-tv-xz]{3,}$/.test(t.c) && SKEL.has(t.n1)) return true;
    if (t.c.length >= 6 && /^[a-z]+$/.test(t.c) && !EMB_OK.test(t.c)) return ROOTS.some(r => t.c.includes(r));
    return false;
  };
  function wildcardSpans(text) {
    const spans = [];
    if (!/[*#%&^~]/.test(text)) return spans;
    for (const m of text.matchAll(/[a-z*#%&^~]{3,}/gi)) {
      const w = m[0].toLowerCase();
      if (!/[a-z]/.test(w) || !/[*#%&^~]/.test(w)) continue;
      if (/[\p{L}\p{N}]/u.test(text[m.index - 1] || '') || /[\p{L}\p{N}]/u.test(text[m.index + w.length] || '')) continue;
      const cands = BYLEN.get(w.length); if (!cands) continue;
      if (cands.some(x => { for (let i = 0; i < x.length; i++) { if ('*#%&^~'.indexOf(w[i]) < 0 && w[i] !== x[i]) return false; } return true; })) spans.push([m.index, m.index + w.length]);
    }
    return spans;
  }
  // Split-word evasion: "كس سك" / "ك س مك" / "fu.ck" -> glue 2-3 neighbouring tokens and test the result.
  // separators people put between the pieces of a word (apostrophes are NOT included, so "who're" never glues into "whore")
  const SYM = '_\\-*|\\/\\\\~+—–−·•°^…:;`=#%&?!<>()\\[\\]{}\\p{Extended_Pictographic}\\uFE0F';
  const SEP1 = new RegExp('^[\\s.ـ،,' + SYM + ']*$', 'u');
  const SEP_AR = new RegExp('^[\\s.ـ،؛,' + SYM + ']+$', 'u');
  const SEP_LAT = new RegExp('^\\s*[' + SYM + '][\\s' + SYM + ']*$', 'u');
  // common function words never take part in a glued match (avoids "كل بين" -> كلبين، "كدا بين" -> كدابين)
  const STOP = new Set('كل كدا كده بين في من علي عن الي مع ما لا لو ان اي دي ده دول هو هي انا انت احنا انتم كان مش بس يا لسه خلاص ليه ايه امتي فين مين كام بعد قبل عند حتي او ثم قد هذا هذه اللي عشان علشان لان يعني the a an is are of to in on at it'.split(' '));
  function joinedCount(tokens, i, text) {
    for (let j = 3; j >= 2; j--) {
      if (i + j > tokens.length) continue;
      let c = '', ok = true;
      for (let k = 0; k < j; k++) {
        c += tokens[i + k].c;
        if (k > 0) {
          const sep = AR.test(tokens[i + k].c + tokens[i + k - 1].c) ? SEP_AR : SEP_LAT;
          const gap = text.slice(tokens[i + k - 1].end, tokens[i + k].start);
          if (!sep.test(gap)) { ok = false; break; }
          // plain spaces: both neighbours must be real fragments (2+ letters), so "ك سك" style lone letters in normal text don't match
          if (/^\s+$/u.test(gap)) {
            const arPair = AR.test(tokens[i + k].c + tokens[i + k - 1].c);
            const lastLone = tokens[i + k].end - tokens[i + k].start < 2, prevLone = tokens[i + k - 1].end - tokens[i + k - 1].start < 2;
            // plain spaces: Latin pieces must be 2+ letters; Arabic may START with one lone letter (ك سك) but a lone letter after a word is never glued
            if (arPair ? (lastLone || (prevLone && k > 1)) : (lastLone || prevLone)) { ok = false; break; }
          }
        }
      }
      if (!ok || c.length < 3) continue;
      if (tokens.slice(i, i + j).some(t => STOP.has(t.n))) continue;
      if (!forbidden({ c, ...keys(c) })) continue;
      if (tokens.slice(i + 1, i + j).some(forbidden)) continue; // later piece already a bad word: normal handling is enough
      return j;
    }
    return 0;
  }
  // Leet / symbol substitution (sh!t, a$$, f4ck, b1tch, pen15). 1:1 character mapping so offsets stay aligned with the original text.
  const LEET_D = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };
  const LEET_S = { '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
  function leet(text) {
    // symbol runs between two letters/digits: a$$hole, sh!t, f@ck   |   digit runs touching a Latin letter: f4ck, pen15, b1tch
    let out = text.replace(/(?<=[a-z0-9])[@$!|+]+(?=[a-z0-9])/gi, run => Array.from(run, ch => LEET_S[ch]).join(''));
    out = out.replace(/[0-9]+/g, (run, off, str) => (/[a-z]/i.test(str[off - 1] || '') || /[a-z]/i.test(str[off + run.length] || '')) ? Array.from(run, ch => LEET_D[ch] || ch).join('') : run);
    return out !== text ? out : null;
  }
  function scan(text, useLiteral) {
    const raw = [];
    for (const m of text.matchAll(TOKEN)) {
      const c = clean(m[0]); if (c) raw.push({ c, start: m.index, end: m.index + m[0].length });
    }
    const tokens = [];
    for (let i = 0; i < raw.length; i++) {
      const t = { ...raw[i] };
      if (t.c.length === 1) {
        while (i + 1 < raw.length && raw[i + 1].c.length === 1 && SEP1.test(text.slice(t.end, raw[i + 1].start))) { t.c += raw[++i].c; t.end = raw[i].end; }
      }
      Object.assign(t, keys(t.c));
      tokens.push(t);
    }
    const spans = [];
    let segBudget = 3000;
    for (let i = 0; i < tokens.length; i++) {
      let count = 0;
      const t = tokens[i];
      const leads = [t];
      if (AR.test(t.n)) for (const s of stems(t.n)) leads.push({ c: s, ...keys(s) });
      outer: for (const L of leads) {
        for (const p of (phrases.get(L.n1) || [])) {
          if (p.every((w, j) => j === 0 ? same(L, w) : (tokens[i + j] && same(tokens[i + j], w) && /^\s+$/u.test(text.slice(tokens[i + j - 1].end, tokens[i + j].start))))) { count = p.length; break outer; }
        }
      }
      if (!count) count = joinedCount(tokens, i, text);
      if (!count && (forbidden(t) || latinExtra(t))) count = 1;
      if (!count && AR.test(t.n) && t.n.length >= 8 && t.n.length <= 24 && segBudget-- > 0 && segHit(t.n)) count = 1;
      if (count) { spans.push([t.start, tokens[i + count - 1].end]); i += count - 1; }
    }
    if (useLiteral && literalPattern) for (const m of text.matchAll(literalPattern)) spans.push([m.index, m.index + m[0].length]);
    if (useLiteral) for (const sp of wildcardSpans(text)) spans.push(sp);
    return spans;
  }
  function maskChunk(text) {
    const spans = scan(text, true);
    const lt = leet(text);
    if (lt) for (const s of scan(lt, false)) spans.push(s);
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = []; for (const span of spans) { const prev = merged[merged.length - 1]; if (prev && span[0] < prev[1]) prev[1] = Math.max(prev[1], span[1]); else merged.push([span[0], span[1]]); }
    let out = '', last = 0; for (const [a, b] of merged) { out += text.slice(last, a) + '**'; last = b; } return out + text.slice(last);
  }
  const CHUNK = 8000, MAX_TOTAL = 100000;
  // Fail-closed: anything unexpected (bad input type, internal error, absurd length) returns '**' instead of the raw text.
  function mask(value) {
    try {
      const text = String(value ?? ''); if (!text) return text;
      if (text.length > MAX_TOTAL) return '**';
      if (text.length <= CHUNK) return maskChunk(text);
      let out = '', i = 0;
      while (i < text.length) {
        let j = Math.min(i + CHUNK, text.length);
        if (j < text.length) { const cut = Math.max(text.lastIndexOf(' ', j), text.lastIndexOf('\n', j)); if (cut > i + CHUNK / 2) j = cut + 1; }
        out += maskChunk(text.slice(i, j)); i = j;
      }
      return out;
    } catch (e) { return '**'; }
  }
  function filename(value) {
    try {
      const s = String(value ?? ''), m = /\.[a-z0-9]{1,12}$/i.exec(s);
      return m ? mask(s.slice(0, m.index)) + m[0] : mask(s);
    } catch (e) { return '**'; }
  }
  const maskIf = v => typeof v === 'string' ? mask(v) : v;
  // Change only text fields of the outgoing public payload, never identity or media URLs.
  function payload(data, chatId) {
    if (chatId !== 'public' || !data || typeof data !== 'object') return data;
    try {
      if (typeof data.text === 'string') data.text = mask(data.text);
      if (typeof data.fileName === 'string') data.fileName = filename(data.fileName);
      if (data.reply && typeof data.reply === 'object') {
        const r = { ...data.reply };
        if (typeof r.text === 'string') r.text = mask(r.text);
        if (typeof r.fileName === 'string') r.fileName = filename(r.fileName);
        data.reply = r;
      }
      if (data.poll && typeof data.poll === 'object') {
        const p = { ...data.poll };
        if (typeof p.question === 'string') p.question = mask(p.question);
        if (Array.isArray(p.options)) p.options = p.options.map(o => (o && typeof o === 'object' && typeof o.text === 'string') ? { ...o, text: mask(o.text) } : maskIf(o));
        data.poll = p;
      }
    } catch (e) {
      if (typeof data.text === 'string') data.text = '**';
    }
    return data;
  }
  // Quick health check: known bad stays masked, known good stays clean.
  function selfTest() {
    try {
      const bad = ['كس امك', 'k s m k'.replace(/ /g, '.'), 'f.u.c.k', 'sh!t', 'ياكلب', 'كسسسك'];
      const good = ['but as con', 'الحس الفني', 'Vikings win', 'خولة ومصر'];
      return bad.every(s => mask(s) !== s) && good.every(s => mask(s) === s);
    } catch (e) { return false; }
  }
  const api = Object.freeze({ mask, filename, payload, selfTest, wordCount: BAD_WORDS.length, version: 7 });
  try { Object.defineProperty(window, 'BariqProfanity', { value: api, writable: false, configurable: false, enumerable: true }); }
  catch (e) { if (!window.BariqProfanity) window.BariqProfanity = api; }
  if (!selfTest() && typeof console !== 'undefined') console.error('BariqProfanity self-test failed');
})();
