//Beautify and number-formatting adapted from the Frozen Cookies add-on (http://cookieclicker.wikia.com/wiki/Frozen_Cookies_%28JavaScript_Add-on%29)
function formatEveryThirdPower(notations)
{
	return function (value)
	{
		var base = 0,
			notationValue = '';
		if (value >= 1000000 && isFinite(value))
		{
			value /= 1000;
			while(Math.round(value) >= 1000)
			{
				value /= 1000;
				base++;
			}
			if (base > notations.length) {return 'Infinity';} else {notationValue = notations[base];}
		}
		return ( Math.round(value * 1000) / 1000 ) + notationValue;
	};
}

function rawFormatter(value) {return Math.round(value * 1000) / 1000;}

var numberFormatters =
	[
		rawFormatter,
		formatEveryThirdPower([
			'',
			' million',
			' billion',
			' trillion',
			' quadrillion',
			' quintillion',
			' sextillion',
			' septillion',
			' octillion',
			' nonillion',
			' decillion'
		]),
		formatEveryThirdPower([
			'',
			' M',
			' B',
			' T',
			' Qa',
			' Qi',
			' Sx',
			' Sp',
			' Oc',
			' No',
			' Dc'
		])
	];

function Beautify(value,floats)
{
	var negative=(value<0);
	var decimal='';
	if (value<1000000 && floats>0) decimal='.'+(value.toFixed(floats).toString()).split('.')[1];
	value=Math.floor(Math.abs(value));
	var formatter=numberFormatters[1];
	var output=formatter(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
	return negative?'-'+output:output+decimal;
}

//        var triangular = function (value) {
//            var abs = Math.abs(value);
//            return ((abs / 2) * (abs + 1)) * (abs / value) || 0;
//        };

var hsv2rgb = function(h, s, v) {
	// adapted from http://schinckel.net/2012/01/10/hsv-to-rgb-in-javascript/
	var rgb, i, data = [];
	if (s === 0) {
		rgb = [v,v,v];
	} else {
		h = h / 60;
		i = Math.floor(h);
		data = [v*(1-s), v*(1-s*(h-i)), v*(1-s*(1-(h-i)))];
		switch(i) {
			case 0:
				rgb = [v, data[2], data[0]];
				break;
			case 1:
				rgb = [data[1], v, data[0]];
				break;
			case 2:
				rgb = [data[0], v, data[2]];
				break;
			case 3:
				rgb = [data[0], data[1], v];
				break;
			case 4:
				rgb = [data[2], data[0], v];
				break;
			default:
				rgb = [v, data[0], data[1]];
				break;
		}
	}
	return '#' + rgb.map(function(x){
		return ("0" + Math.round(x*255).toString(16)).slice(-2);
	}).join('');
};

function percent2hsv(val) {
	var h;
	var s;
	var v;
	if (val > 100) {
		val = 100;
	}
	else if (val < 0) {
		val = 0;
	}
	h = Math.floor((100 - val) * 120 / 100);
	s = 1;
	v = 1;

	return {
		h: h,
		s: s,
		v: v
	}
}