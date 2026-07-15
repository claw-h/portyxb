// src/components/heartWorker.ts

self.onmessage = function (e: MessageEvent) {
	// Explicitly type the incoming message payload
	const { vertexBuffers, minY, maxY, sliceCount } = e.data as {
		vertexBuffers: Float32Array[];
		minY: number;
		maxY: number;
		sliceCount: number;
	};
	
	const height = maxY - minY;
	const overlap = height * 0.035;
	const slicedBuffers: Float32Array[] = [];

	for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
		const low = minY + (height / sliceCount) * sliceIndex - overlap;
		const high = minY + (height / sliceCount) * (sliceIndex + 1) + overlap;
		
		// FIX 2: Explicitly type the array to prevent the implicit 'any[]' error
		const slicePositions: number[] = [];
		
		for (let b = 0; b < vertexBuffers.length; b++) {
			const source = vertexBuffers[b];
			// Loop through faces (every 9 elements represents 3 vertices of a triangle)
			for (let i = 0; i < source.length; i += 9) {
				const y = (source[i + 1] + source[i + 4] + source[i + 7]) / 3;
				if (y >= low && y <= high) {
					for (let v = 0; v < 9; v++) {
						slicePositions.push(source[i + v]);
					}
				}
			}
		}
		
		slicedBuffers.push(new Float32Array(slicePositions));
	}

	// FIX 1: Cast self to Worker context so TypeScript recognizes the correct postMessage signature
	(self as unknown as Worker).postMessage(
		{ slicedBuffers },
		slicedBuffers.map(b => b.buffer)
	);
};