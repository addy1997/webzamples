const vert = `
// I guess we're copying PHONG
#define PHONG

// REFLECTION
uniform mat4 reflectionMatrix;
varying vec4 reflectionUV;

varying vec3 vViewPosition;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <uv_pars_vertex>
#include <uv2_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	// REFLECTION
	reflectionUV = reflectionMatrix * vec4( position, 1.0 );

	#include <uv_vertex>
	#include <uv2_vertex>
	#include <color_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}
`

const frag = `
#define PHONG

// REFLECTION
uniform sampler2D reflectionDiffuse;
varying vec4 reflectionUV;
uniform float blendingIntensity;

uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <uv2_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// REFLECTOR BLEND
float blendOverlay( float base, float blend ) {
	return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
}

vec3 blendOverlay( vec3 base, vec3 blend ) {
	return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
}

void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>

	// REFLECTION - apply to the existing color / texture
	vec4 reflectionTexel = texture2DProj( reflectionDiffuse, reflectionUV );
	diffuseColor = mix(vec4(1.0, 1.0, 1.0, 1.0), diffuseColor, blendingIntensity);
	diffuseColor *= reflectionTexel;


	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	gl_FragColor = vec4( outgoingLight, diffuseColor.a );
	#include <tonemapping_fragment>
	#include <encodings_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}
`

const PhongReflector = function (geometry, phongOptions, reflectionOptions) {

	THREE.Mesh.call(this, geometry);

	this.type = 'Reflector';

	var scope = this;

	var options = reflectionOptions || {};

	var textureWidth = options.textureWidth || 512;
	var textureHeight = options.textureHeight || 512;
	var clipBias = options.clipBias || 0;
	var blendingIntensity = options.blendingIntensity || 0;
	var phongShader = phongShader;

	//

	var reflectorPlane = new THREE.Plane();
	var normal = new THREE.Vector3();
	var reflectorWorldPosition = new THREE.Vector3();
	var cameraWorldPosition = new THREE.Vector3();
	var rotationMatrix = new THREE.Matrix4();
	var lookAtPosition = new THREE.Vector3(0, 0, - 1);
	var clipPlane = new THREE.Vector4();
	var view = new THREE.Vector3();
	var target = new THREE.Vector3();
	var q = new THREE.Vector4();

	var textureMatrix = new THREE.Matrix4();
	var virtualCamera = new THREE.PerspectiveCamera();

	var parameters = {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat
	};

	var renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, parameters);
	if (!THREE.MathUtils.isPowerOfTwo(textureWidth) || !THREE.MathUtils.isPowerOfTwo(textureHeight)) {
		renderTarget.texture.generateMipmaps = false;
	}

	var material = new THREE.MeshPhongMaterial(phongOptions);
	// add the "reflection" stuff
	material.onBeforeCompile = (shader, program) => {
		phongShader = shader;
		shader.uniforms['blendingIntensity'] = { value: blendingIntensity };
		shader.uniforms['reflectionDiffuse'] = { value: renderTarget.texture };
		shader.uniforms['reflectionMatrix'] = { value: textureMatrix };
		shader.fragmentShader = frag;
		shader.vertexShader = vert;
	}

	this.material = material;

	this.updateRT = function(_textureWidth, _textureHeight) {
		var newTextureWidth = _textureWidth || 512;
		var newTextureHeight = _textureHeight || 512;
		// ignore if the dimensions are the same
		if (newTextureHeight === textureHeight && newTextureWidth === textureWidth) {
			return
		}
		textureWidth = newTextureWidth;
		textureHeight = newTextureHeight;
		renderTarget.setSize(textureWidth, textureHeight)
	}

	this.update = function (renderer, scene, camera) {
		if (!renderTarget) return;
		reflectorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
		cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

		rotationMatrix.extractRotation(scope.matrixWorld);

		normal.set(0, 0, 1);
		normal.applyMatrix4(rotationMatrix);

		view.subVectors(reflectorWorldPosition, cameraWorldPosition);

		// Avoid rendering when reflector is facing away

		if (view.dot(normal) > 0) return;

		view.reflect(normal).negate();
		view.add(reflectorWorldPosition);

		rotationMatrix.extractRotation(camera.matrixWorld);

		lookAtPosition.set(0, 0, - 1);
		lookAtPosition.applyMatrix4(rotationMatrix);
		lookAtPosition.add(cameraWorldPosition);

		target.subVectors(reflectorWorldPosition, lookAtPosition);
		target.reflect(normal).negate();
		target.add(reflectorWorldPosition);

		virtualCamera.position.copy(view);
		virtualCamera.up.set(0, 1, 0);
		virtualCamera.up.applyMatrix4(rotationMatrix);
		virtualCamera.up.reflect(normal);
		virtualCamera.lookAt(target);

		virtualCamera.near = camera.near; // Used in WebGLBackground
		virtualCamera.far = camera.far; // Used in WebGLBackground

		virtualCamera.updateMatrixWorld();
		virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

		// Update the texture matrix
		textureMatrix.set(
			0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 0.5, 0.5,
			0.0, 0.0, 0.0, 1.0
		);
		textureMatrix.multiply(virtualCamera.projectionMatrix);
		textureMatrix.multiply(virtualCamera.matrixWorldInverse);
		textureMatrix.multiply(scope.matrixWorld);

		// Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
		// Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
		reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
		reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);

		clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);

		var projectionMatrix = virtualCamera.projectionMatrix;

		q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
		q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
		q.z = - 1.0;
		q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

		// Calculate the scaled plane vector
		clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

		// Replacing the third row of the projection matrix
		projectionMatrix.elements[2] = clipPlane.x;
		projectionMatrix.elements[6] = clipPlane.y;
		projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
		projectionMatrix.elements[14] = clipPlane.w;

		// Render

		renderTarget.texture.encoding = renderer.outputEncoding;

		scope.visible = false;

		var currentRenderTarget = renderer.getRenderTarget();

		var currentXrEnabled = renderer.xr.enabled;
		var currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

		renderer.xr.enabled = false; // Avoid camera modification
		renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows

		renderer.setRenderTarget(renderTarget);

		renderer.state.buffers.depth.setMask(true); // make sure the depth buffer is writable so it can be properly cleared, see #18897

		if (renderer.autoClear === false) renderer.clear();
		renderer.render(scene, virtualCamera);

		renderer.xr.enabled = currentXrEnabled;
		renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

		renderer.setRenderTarget(currentRenderTarget);

		// Restore viewport

		var viewport = camera.viewport;

		if (viewport !== undefined) {

			renderer.state.viewport(viewport);

		}

		scope.visible = true;

	};

	this.getRenderTarget = function () {

		return renderTarget;

	};

};

PhongReflector.prototype = Object.create(THREE.Mesh.prototype);
PhongReflector.prototype.constructor = PhongReflector;

PhongReflector.ReflectorShader = THREE.MeshPhongMaterial;

export { PhongReflector };