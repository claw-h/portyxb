import { 
	BufferGeometry, 
	BufferAttribute, 
	EdgesGeometry, 
	Box3, 
	Vector3, 
	Matrix4, 
	Mesh,
	Object3D,
	SphereGeometry
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

function mergeModelGeometry(model: Object3D): BufferGeometry[] {
	const geometries: BufferGeometry[] = [];
	const modelBox = new Box3();
	model.updateWorldMatrix(true, true);

	model.traverse((child) => {
		if (!(child instanceof Mesh) || !child.geometry) return;
		const geometry = child.geometry.clone() as BufferGeometry;

		['position', 'normal'].forEach((key) => {
			const attr = geometry.attributes[key];
			if (attr && !(attr.array instanceof Float32Array)) {
				const floatArray = new Float32Array(attr.count * attr.itemSize);
				for (let i = 0; i < attr.count; i++) {
					if (attr.itemSize >= 1) floatArray[i * attr.itemSize] = attr.getX(i);
					if (attr.itemSize >= 2) floatArray[i * attr.itemSize + 1] = attr.getY(i);
					if (attr.itemSize >= 3) floatArray[i * attr.itemSize + 2] = attr.getZ(i);
				}
				geometry.setAttribute(key, new BufferAttribute(floatArray, attr.itemSize));
			}
		});

		geometry.applyMatrix4(child.matrixWorld);
		geometry.deleteAttribute('uv');
		const nonIndexed = geometry.toNonIndexed();
		nonIndexed.computeBoundingBox();
		modelBox.union(nonIndexed.boundingBox!);
		geometries.push(nonIndexed);
	});

	if (!geometries.length) return [];

	const center = new Vector3();
	const size = new Vector3();
	modelBox.getCenter(center);
	modelBox.getSize(size);
	const scale = 3.05 / Math.max(size.x, size.y, size.z);
	const normalize = new Matrix4()
		.makeTranslation(-center.x, -center.y, -center.z)
		.premultiply(new Matrix4().makeScale(scale, scale, scale));

	return geometries.map((geometry) => {
		geometry.applyMatrix4(normalize);
		geometry.computeVertexNormals();
		return geometry;
	});
}

async function loadAndProcess(url: string, sliceCount: number) {
	let geometries: BufferGeometry[] = [];
	
	try {
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		
		// Adjust the URL if it doesn't have an origin so fetch works in the worker
		const fetchUrl = url.startsWith('/') ? self.location.origin + url : url;
		const gltf = await loader.loadAsync(fetchUrl);
		geometries = mergeModelGeometry(gltf.scene);
	} catch (error) {
		console.error("Worker failed to load GLTF, using fallback.", error);
		const fallback = new SphereGeometry(1.2, 64, 32).toNonIndexed();
		fallback.scale(0.82, 1.16, 0.72);
		geometries = [fallback];
	}

	const box = new Box3();
	geometries.forEach((g) => {
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	});
	
	const minY = box.min.y;
	const maxY = box.max.y;
	const vertexBuffers = geometries.map(g => g.attributes.position.array as Float32Array);
	const solidBuffers = geometries.map(g => {
		return {
			position: g.attributes.position.array as Float32Array,
			normal: g.attributes.normal.array as Float32Array
		};
	});

	const height = maxY - minY;
	const overlap = height * 0.035;
	
	const slicedPositions: Float32Array[] = [];
	const slicedNormals: Float32Array[] = [];
	const slicedEdges: Float32Array[] = [];

	for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
		const low = minY + (height / sliceCount) * sliceIndex - overlap;
		const high = minY + (height / sliceCount) * (sliceIndex + 1) + overlap;
		
		const slicePositions: number[] = [];
		
		for (let b = 0; b < vertexBuffers.length; b++) {
			const source = vertexBuffers[b];
			for (let i = 0; i < source.length; i += 9) {
				const y = (source[i + 1] + source[i + 4] + source[i + 7]) / 3;
				if (y >= low && y <= high) {
					for (let v = 0; v < 9; v++) {
						slicePositions.push(source[i + v]);
					}
				}
			}
		}
		
		const posArray = new Float32Array(slicePositions);
		const sliceGeometry = new BufferGeometry();
		sliceGeometry.setAttribute('position', new BufferAttribute(posArray, 3));
		sliceGeometry.computeVertexNormals();
		
		// The threshold angle is 22 degrees to match the main thread
		const edgesGeom = new EdgesGeometry(sliceGeometry, 22);
		
		slicedPositions.push(posArray);
		slicedNormals.push(sliceGeometry.attributes.normal.array as Float32Array);
		slicedEdges.push(edgesGeom.attributes.position.array as Float32Array);
	}

	const transferables: ArrayBuffer[] = [];
	slicedPositions.forEach(b => transferables.push(b.buffer));
	slicedNormals.forEach(b => transferables.push(b.buffer));
	slicedEdges.forEach(b => transferables.push(b.buffer));
	
	solidBuffers.forEach(s => {
		transferables.push(s.position.buffer);
		transferables.push(s.normal.buffer);
	});

	(self as unknown as Worker).postMessage(
		{ slicedPositions, slicedNormals, slicedEdges, solidBuffers },
		transferables
	);
}

self.onmessage = function (e: MessageEvent) {
	const { url, sliceCount } = e.data as {
		url: string;
		sliceCount: number;
	};
	loadAndProcess(url, sliceCount);
};