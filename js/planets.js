var digrams = "ABOUSEITILETSTONLONUTHNO" +
	"LEXEGEZACEBISOUSESARMAINDIREAERATENBERALAVETIEDORQUANTEISRION";

function rotatel(x) {
	var tmp = (x & 255) * 2;
	if (tmp > 255) tmp -= 255;
	return tmp;
}

function twist(x) {
	return (256 * rotatel(x / 256)) + rotatel(x & 255);
}

function next(seeds) {
	return seeds.map(function(seed) {
		return twist(seed);
	});
}

function tweakseed(seeds) {
	var tmp;

	tmp = seeds.reduce(function(total, seed) {
		return total += seed;
	}, 0);

	return seeds.map( function ( seed, index, arr ) {
		return arr[index + 1] || (tmp & 65535)
	});
}


function makename(pairs, seeds)
{
	var name = [];
	var pair = [0, 0, 0, 0];
	var longname = seeds[0] & 64;

	pair = pair.map(function() {
		seeds = tweakseed(seeds);
		return 2 * ((seeds[2] / 256) & 31);
	});

	pair.forEach(function(value, index, arr) {
		if (longname || ( index < (arr.length - 1))) {
			name.push(pairs[value]);
			name.push(pairs[value + 1]);
		}
	});

	return name.join('').toLowerCase()
		.replace(/^\w/,  function(letter) {
			return letter.toUpperCase();
		});
}

function genNames()
{
	var names = [];
	var pairs;
	var seeds = [23114, 584, 46931];
	pairs = digrams.substring(24);

	for(var i = 0; i < 256; ++i) {
		names.push( makename(pairs, seeds) );
		seeds = tweakseed(next(seeds));
	}

	return names;
}